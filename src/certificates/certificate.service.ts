import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { Certificate } from '../schemas/certificate.schema';
import { Enrollment } from '../schemas/enrollment.schema';
import { Course } from '../schemas/course.schema';
import { User } from '../schemas/user.schema';
import PDFDocument = require('pdfkit');

@Injectable()
export class CertificateService {
  constructor(
    @InjectModel(Certificate.name) private certificateModel: Model<Certificate>,
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async getCertificateById(id: string) {
    // First try to find as a certificate
    const certificate = await this.certificateModel.findById(id);
    if (certificate) {
      return certificate;
    }

    // If not found, try to find as an enrollment and generate certificate data
    return this.getCertificateFromEnrollment(id);
  }

  async getCertificateByIdWithAuth(id: string, userId: string) {
    const certData = await this.getCertificateById(id);
    
    // Verify ownership - check if the certificate belongs to the user
    const enrollment = await this.enrollmentModel.findById(id);
    if (enrollment && enrollment.studentId.toString() !== userId) {
      // Check if user is admin (optional - you can add role check here)
      throw new NotFoundException('Certificate not found or access denied');
    }
    
    return certData;
  }

  async getCertificateByPublicId(publicId: string) {
    // Try to find enrollment by certificate public ID
    const enrollment = await this.enrollmentModel
      .findOne({ certificatePublicId: publicId })
      .populate('studentId', 'firstName lastName')
      .populate('courseId', 'title instructorId')
      .exec();

    if (!enrollment) {
      throw new NotFoundException('Certificate not found');
    }

    if (!enrollment.isCompleted || !enrollment.certificateEarned) {
      throw new NotFoundException('Certificate not available');
    }

    return this.buildCertificateData(enrollment);
  }

  async getCertificateFromEnrollment(enrollmentId: string) {
    console.log('Looking for enrollment:', enrollmentId);
    
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('studentId', 'firstName lastName')
      .populate('courseId', 'title instructorId')
      .exec();

    if (!enrollment) {
      console.error('Enrollment not found:', enrollmentId);
      throw new NotFoundException('Enrollment not found');
    }

    console.log('Enrollment found:', {
      id: enrollment._id,
      isCompleted: enrollment.isCompleted,
      certificateEarned: enrollment.certificateEarned,
      publicId: enrollment.certificatePublicId,
    });

    if (!enrollment.isCompleted || !enrollment.certificateEarned) {
      throw new NotFoundException('Certificate not available - course not completed or certificate not earned');
    }

    // Generate public ID if not exists
    if (!enrollment.certificatePublicId) {
      const crypto = require('crypto');
      enrollment.certificatePublicId = crypto.randomUUID();
      await enrollment.save();
    }

    return this.buildCertificateData(enrollment);
  }

  private async buildCertificateData(enrollment: any) {
    const student = enrollment.studentId as any;
    const course = enrollment.courseId as any;
    
    if (!student || !course) {
      throw new NotFoundException('Invalid enrollment data');
    }
    
    const instructor = await this.userModel.findById(course.instructorId).select('firstName lastName');

    const certificateData = {
      _id: enrollment._id,
      publicId: enrollment.certificatePublicId,
      studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Student',
      courseName: course.title || 'Course',
      scoreAchieved: enrollment.finalAssessmentScore || enrollment.totalScore || 0,
      instructorName: instructor ? `${instructor.firstName || ''} ${instructor.lastName || ''}`.trim() : 'Instructor',
      issuedDate: enrollment.certificateIssuedAt || enrollment.completedAt || new Date(),
      certificateNumber: `CERT-${enrollment._id.toString().slice(-8).toUpperCase()}`,
    };
    
    console.log('Certificate data generated:', certificateData);
    return certificateData;
  }

  async generateCertificatePDF(certificateId: string): Promise<Buffer> {
    let certificate: any = await this.certificateModel.findById(certificateId);
    
    if (!certificate) {
      // Try to get certificate from enrollment
      certificate = await this.getCertificateFromEnrollment(certificateId);
    }
    
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }

    return this.createPDFBuffer(certificate);
  }

  async generateCertificatePDFWithAuth(certificateId: string, userId: string): Promise<Buffer> {
    let certificate: any = await this.certificateModel.findById(certificateId);
    
    if (!certificate) {
      // Try to get certificate from enrollment
      certificate = await this.getCertificateFromEnrollment(certificateId);
    }
    
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }

    // Verify ownership
    const enrollment = await this.enrollmentModel.findById(certificateId);
    if (enrollment && enrollment.studentId.toString() !== userId) {
      throw new NotFoundException('Certificate not found or access denied');
    }

    return this.createPDFBuffer(certificate);
  }

  async createPDFBuffer(certificate: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Certificate Design - Modern Professional Look
      const primaryColor = '#021d49';
      const secondaryColor1 = '#00c4b3';
      const secondaryColor2 = '#039e8e';
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const logoPath = process.env.CERTIFICATE_LOGO_PATH
        ? path.resolve(process.env.CERTIFICATE_LOGO_PATH)
        : path.join(__dirname, '..', '..', 'assets', 'arin-logo.png');

      // Elegant border with gradient effect
      doc.rect(20, 20, pageWidth - 40, pageHeight - 40)
        .lineWidth(4)
        .strokeColor(primaryColor)
         .stroke();

      doc.rect(28, 28, pageWidth - 56, pageHeight - 56)
         .lineWidth(1)
        .strokeColor(secondaryColor1)
         .stroke();

      // Inner decorative corners
      const cornerSize = 40;
      doc.rect(40, 40, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();
      doc.rect(pageWidth - 40 - cornerSize, 40, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();
      doc.rect(40, pageHeight - 40 - cornerSize, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();
      doc.rect(pageWidth - 40 - cornerSize, pageHeight - 40 - cornerSize, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();

      // Logo (centered at top)
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, pageWidth / 2 - 60, 52, { width: 120, height: 60, fit: [120, 60] });
      } else {
        doc.fontSize(48)
           .font('Helvetica-Bold')
           .fillColor(primaryColor)
           .text('🎓', pageWidth / 2 - 24, 60, { width: 48, align: 'center' });
      }

      // Title
      doc.fontSize(42)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
         .text('CERTIFICATE OF COMPLETION', 0, 130, {
           align: 'center',
           width: pageWidth
         });

      // Decorative line under title
      doc.moveTo(pageWidth / 2 - 150, 185)
        .lineTo(pageWidth / 2 + 150, 185)
        .lineWidth(3)
        .strokeColor(secondaryColor1)
         .stroke();

      // Main text
      doc.fontSize(18)
        .font('Helvetica')
        .fillColor('#374151')
        .text('This is to certify that', 0, 220, {
           align: 'center',
           width: pageWidth
         });

      // Student name with elegant styling
      doc.fontSize(36)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(certificate.studentName, 0, 260, {
           align: 'center',
           width: pageWidth
         });

      // Has successfully completed
      doc.fontSize(18)
        .font('Helvetica')
        .fillColor('#374151')
        .text('has successfully completed the course', 0, 315, {
           align: 'center',
           width: pageWidth
         });

      // Course name with elegant box
      const courseBoxY = 350;
      doc.roundedRect(pageWidth / 4, courseBoxY, pageWidth / 2, 60, 10)
        .fillAndStroke('#ecfeff', secondaryColor2);

      doc.fontSize(26)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
         .text(certificate.courseName, pageWidth / 4, courseBoxY + 17, {
           align: 'center',
           width: pageWidth / 2
         });

      // Score badge
      const score = (certificate as any).scoreAchieved || (certificate as any).score;
      if (score) {
        const badgeX = pageWidth / 2 - 60;
          const badgeY = 430;
        
        doc.circle(badgeX + 60, badgeY + 20, 35)
            .fillAndStroke(secondaryColor1, secondaryColor2);
        
        doc.fontSize(20)
           .font('Helvetica-Bold')
           .fillColor('#ffffff')
           .text(`${score.toFixed(0)}%`, badgeX, badgeY + 8, {
             width: 120,
             align: 'center'
           });
      }

      // Date section
      const dateStr = new Date(certificate.issuedDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      doc.fontSize(14)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text(`Issued on ${dateStr}`, 0, 490, {
           align: 'center',
           width: pageWidth
         });

      // Signature section
      const sigY = pageHeight - 140;
      const leftSigX = pageWidth / 2 - 250;
      const rightSigX = pageWidth / 2 + 50;

      // Instructor signature line
      doc.moveTo(leftSigX, sigY)
         .lineTo(leftSigX + 180, sigY)
         .strokeColor('#374151')
         .lineWidth(1.5)
         .stroke();

      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
         .text(certificate.instructorName, leftSigX, sigY + 10, {
           width: 180,
           align: 'center'
         });

      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text('Instructor Signature', leftSigX, sigY + 28, {
           width: 180,
           align: 'center'
         });

      // Date line
      doc.moveTo(rightSigX, sigY)
         .lineTo(rightSigX + 180, sigY)
         .strokeColor('#374151')
         .lineWidth(1.5)
         .stroke();

      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
         .text(dateStr, rightSigX, sigY + 10, {
           width: 180,
           align: 'center'
         });

      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text('Date Issued', rightSigX, sigY + 28, {
           width: 180,
           align: 'center'
         });

      // Certificate ID
      doc.fontSize(10)
        .font('Helvetica')
        .fillColor(secondaryColor2)
        .text('Arin in collaboration with Taylor & Francis', 0, pageHeight - 88, {
          align: 'center',
          width: pageWidth
        });

      doc.fontSize(9)
        .font('Helvetica')
        .fillColor('#9ca3af')
        .text(`Certificate ID: ${certificate.certificateNumber || certificate._id}`, 0, pageHeight - 70, {
           align: 'center',
           width: pageWidth
         });

      // Footer
      doc.fontSize(11)
         .fillColor('#6b7280')
         .text('This certificate validates the successful completion of the course requirements', 0, pageHeight - 50, {
           align: 'center',
           width: pageWidth
         });

      // Seal/Badge on the right corner
      const sealX = pageWidth - 120;
      const sealY = pageHeight - 160;
      doc.circle(sealX, sealY, 45)
        .fillAndStroke(secondaryColor2, primaryColor);
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .fillColor('#ffffff')
         .text('VERIFIED', sealX - 30, sealY - 20, {
           width: 60,
           align: 'center'
         });
      
      doc.fontSize(8)
         .text('CERTIFICATE', sealX - 30, sealY - 5, {
           width: 60,
           align: 'center'
         });
      
      doc.fontSize(16)
         .text('✓', sealX - 8, sealY + 8);

      doc.end();
    });
  }
}
