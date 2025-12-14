import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

      // Certificate Design
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      // Border
      doc.rect(30, 30, pageWidth - 60, pageHeight - 60)
         .lineWidth(3)
         .strokeColor('#1e40af')
         .stroke();

      doc.rect(40, 40, pageWidth - 80, pageHeight - 80)
         .lineWidth(1)
         .strokeColor('#93c5fd')
         .stroke();

      // Title
      doc.fontSize(36)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text('CERTIFICATE OF COMPLETION', 0, 100, {
           align: 'center',
           width: pageWidth
         });

      // Decorative line
      doc.moveTo(pageWidth / 2 - 100, 160)
         .lineTo(pageWidth / 2 + 100, 160)
         .lineWidth(2)
         .strokeColor('#93c5fd')
         .stroke();

      // Main text
      doc.fontSize(16)
         .font('Helvetica')
         .fillColor('#374151')
         .text('This is to certify that', 0, 200, {
           align: 'center',
           width: pageWidth
         });

      // Student name
      doc.fontSize(32)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text(certificate.studentName, 0, 240, {
           align: 'center',
           width: pageWidth
         });

      // Has successfully completed
      doc.fontSize(16)
         .font('Helvetica')
         .fillColor('#374151')
         .text('has successfully completed the course', 0, 290, {
           align: 'center',
           width: pageWidth
         });

      // Course name
      doc.fontSize(24)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text(certificate.courseName, 0, 330, {
           align: 'center',
           width: pageWidth
         });

      // Score
      const score = (certificate as any).scoreAchieved || (certificate as any).score;
      if (score) {
        doc.fontSize(14)
           .font('Helvetica')
           .fillColor('#059669')
           .text(`Final Score: ${score.toFixed(1)}%`, 0, 380, {
             align: 'center',
             width: pageWidth
           });
      }

      // Date
      const dateStr = new Date(certificate.issuedDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      doc.fontSize(12)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text(`Issued on: ${dateStr}`, 0, 430, {
           align: 'center',
           width: pageWidth
         });

      // Instructor signature section
      const leftX = pageWidth / 2 - 200;
      const rightX = pageWidth / 2 + 50;
      const lineY = 500;

      doc.moveTo(leftX, lineY)
         .lineTo(leftX + 150, lineY)
         .strokeColor('#000000')
         .lineWidth(1)
         .stroke();

      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#374151')
         .text(certificate.instructorName, leftX, lineY + 10, {
           width: 150,
           align: 'center'
         });

      doc.fontSize(9)
         .fillColor('#6b7280')
         .text('Instructor', leftX, lineY + 25, {
           width: 150,
           align: 'center'
         });

      // Certificate ID
      doc.fontSize(8)
         .font('Helvetica')
         .fillColor('#9ca3af')
         .text(`Certificate ID: ${certificate._id}`, 0, pageHeight - 80, {
           align: 'center',
           width: pageWidth
         });

      // Footer
      doc.fontSize(10)
         .fillColor('#6b7280')
         .text('This certificate validates the successful completion of the course requirements', 0, pageHeight - 60, {
           align: 'center',
           width: pageWidth
         });

      doc.end();
    });
  }
}
