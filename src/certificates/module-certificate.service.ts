import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleCertificate } from '../schemas/module-certificate.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { Module } from '../schemas/module.schema';
import { User } from '../schemas/user.schema';
import PDFDocument = require('pdfkit');

@Injectable()
export class ModuleCertificateService {
  constructor(
    @InjectModel(ModuleCertificate.name)
    private certificateModel: Model<ModuleCertificate>,
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(Module.name)
    private moduleModel: Model<Module>,
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

  // Get certificate by ID
  async getCertificateById(certificateId: string) {
    const certificate = await this.certificateModel.findById(certificateId);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }
    return certificate;
  }

  // Get certificate by public ID (for public verification)
  async getCertificateByPublicId(publicId: string) {
    const certificate = await this.certificateModel.findOne({ publicId });
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }
    return certificate;
  }

  // Get all certificates for a student
  async getStudentCertificates(studentId: string) {
    return await this.certificateModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .sort({ issuedDate: -1 })
      .lean();
  }

  // Get certificate by enrollment ID
  async getCertificateByEnrollmentId(enrollmentId: string) {
    const certificate = await this.certificateModel.findOne({
      enrollmentId: new Types.ObjectId(enrollmentId),
    });
    if (!certificate) {
      throw new NotFoundException('Certificate not found for this enrollment');
    }
    return certificate;
  }

  // Generate PDF for module certificate
  async generateCertificatePDF(certificateId: string): Promise<Buffer> {
    const certificate = await this.certificateModel.findById(certificateId);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }
    return this.createPDFBuffer(certificate);
  }

  // Generate PDF by public ID
  async generateCertificatePDFByPublicId(publicId: string): Promise<Buffer> {
    const certificate = await this.certificateModel.findOne({ publicId });
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }
    return this.createPDFBuffer(certificate);
  }

  // Generate PDF with auth check
  async generateCertificatePDFWithAuth(
    certificateId: string,
    userId: string,
  ): Promise<Buffer> {
    const certificate = await this.certificateModel.findById(certificateId);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }

    if (certificate.studentId.toString() !== userId) {
      throw new NotFoundException('Certificate not found or access denied');
    }

    return this.createPDFBuffer(certificate);
  }

  // Create PDF buffer
  async createPDFBuffer(certificate: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const primaryColor = '#021d49';
      const secondaryColor1 = '#00c4b3';
      const secondaryColor2 = '#039e8e';
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const logoPath = process.env.CERTIFICATE_LOGO_PATH
        ? path.resolve(process.env.CERTIFICATE_LOGO_PATH)
        : path.join(__dirname, '..', '..', 'assets', 'arin-logo.png');

      // Border
      doc
        .rect(20, 20, pageWidth - 40, pageHeight - 40)
        .lineWidth(4)
        .strokeColor(primaryColor)
        .stroke();

      doc
        .rect(28, 28, pageWidth - 56, pageHeight - 56)
        .lineWidth(1)
        .strokeColor(secondaryColor1)
        .stroke();

      // Corner decorations
      const cornerSize = 40;
      doc.rect(40, 40, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();
      doc.rect(pageWidth - 40 - cornerSize, 40, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();
      doc.rect(40, pageHeight - 40 - cornerSize, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();
      doc.rect(pageWidth - 40 - cornerSize, pageHeight - 40 - cornerSize, cornerSize, cornerSize).strokeColor(secondaryColor2).lineWidth(2).stroke();

      // Logo
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, pageWidth / 2 - 60, 52, { width: 120, height: 60, fit: [120, 60] });
      }

      // Title
      doc
        .fontSize(42)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('CERTIFICATE OF COMPLETION', 0, 130, {
          align: 'center',
          width: pageWidth,
        });

      // Decorative line
      doc
        .moveTo(pageWidth / 2 - 150, 185)
        .lineTo(pageWidth / 2 + 150, 185)
        .lineWidth(3)
        .strokeColor(secondaryColor1)
        .stroke();

      // Body text
      doc
        .fontSize(18)
        .font('Helvetica')
        .fillColor('#374151')
        .text('This is to certify that', 0, 220, {
          align: 'center',
          width: pageWidth,
        });

      // Student name
      doc
        .fontSize(36)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(certificate.studentName, 0, 260, {
          align: 'center',
          width: pageWidth,
        });

      // Completion text
      doc
        .fontSize(18)
        .font('Helvetica')
        .fillColor('#374151')
        .text('has successfully completed the module', 0, 315, {
          align: 'center',
          width: pageWidth,
        });

      // Module name box
      const courseBoxY = 350;
      doc
        .roundedRect(pageWidth / 4, courseBoxY, pageWidth / 2, 60, 10)
        .fillAndStroke('#ecfeff', secondaryColor2);

      doc
        .fontSize(26)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(certificate.moduleName, pageWidth / 4, courseBoxY + 17, {
          align: 'center',
          width: pageWidth / 2,
        });

      // Level and category badges
      const levelLabel = (certificate.moduleLevel || 'beginner').charAt(0).toUpperCase() + (certificate.moduleLevel || 'beginner').slice(1);
      doc
        .fontSize(14)
        .font('Helvetica')
        .fillColor(secondaryColor2)
        .text(`Level: ${levelLabel}  |  Category: ${certificate.categoryName}`, 0, courseBoxY + 70, {
          align: 'center',
          width: pageWidth,
        });

      // Score badge
      if (certificate.scoreAchieved) {
        const badgeX = pageWidth / 2 - 60;
        const badgeY = 440;

        doc.circle(badgeX + 60, badgeY + 20, 35).fillAndStroke(secondaryColor1, secondaryColor2);

        doc
          .fontSize(20)
          .font('Helvetica-Bold')
          .fillColor('#ffffff')
          .text(`${certificate.scoreAchieved}%`, badgeX, badgeY + 8, {
            width: 120,
            align: 'center',
          });
      }

      // Date
      const dateStr = new Date(certificate.issuedDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      doc
        .fontSize(14)
        .font('Helvetica')
        .fillColor('#6b7280')
        .text(`Issued on ${dateStr}`, 0, 495, {
          align: 'center',
          width: pageWidth,
        });

      // Signature section
      const sigY = pageHeight - 140;
      const leftSigX = pageWidth / 2 - 250;
      const rightSigX = pageWidth / 2 + 50;

      // Instructor signature
      doc.moveTo(leftSigX, sigY).lineTo(leftSigX + 180, sigY).strokeColor('#374151').lineWidth(1.5).stroke();
      doc.fontSize(12).font('Helvetica-Bold').fillColor(primaryColor).text(certificate.instructorName, leftSigX, sigY + 10, { width: 180, align: 'center' });
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Instructor Signature', leftSigX, sigY + 28, { width: 180, align: 'center' });

      // Date line
      doc.moveTo(rightSigX, sigY).lineTo(rightSigX + 180, sigY).strokeColor('#374151').lineWidth(1.5).stroke();
      doc.fontSize(12).font('Helvetica-Bold').fillColor(primaryColor).text(dateStr, rightSigX, sigY + 10, { width: 180, align: 'center' });
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Date Issued', rightSigX, sigY + 28, { width: 180, align: 'center' });

      // Footer
      doc.fontSize(10).font('Helvetica').fillColor(secondaryColor2).text('Arin in collaboration with Taylor & Francis', 0, pageHeight - 88, { align: 'center', width: pageWidth });
      doc.fontSize(9).font('Helvetica').fillColor('#9ca3af').text(`Certificate ID: ${certificate.certificateNumber}`, 0, pageHeight - 70, { align: 'center', width: pageWidth });
      doc.fontSize(11).fillColor('#6b7280').text('This certificate validates the successful completion of the module requirements', 0, pageHeight - 50, { align: 'center', width: pageWidth });

      // Verified seal
      const sealX = pageWidth - 120;
      const sealY = pageHeight - 160;
      doc.circle(sealX, sealY, 45).fillAndStroke(secondaryColor2, primaryColor);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff').text('VERIFIED', sealX - 30, sealY - 20, { width: 60, align: 'center' });
      doc.fontSize(8).text('CERTIFICATE', sealX - 30, sealY - 5, { width: 60, align: 'center' });

      doc.end();
    });
  }
}
