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

  // Generate transcript PDF for a student at a given level
  async generateStudentTranscriptPDF(studentId: string, level: string): Promise<Buffer> {
    const student = await this.userModel
      .findById(studentId)
      .select('fullName firstName lastName email')
      .lean();
    const studentName =
      (student as any)?.fullName ||
      `${(student as any)?.firstName || ''} ${(student as any)?.lastName || ''}`.trim() ||
      'Student';

    const modules = await this.moduleModel
      .find({ level, status: 'published', isActive: { $ne: false } })
      .select('_id title lessons')
      .lean();

    const moduleMap = new Map(modules.map((m) => [(m._id as any).toString(), m]));
    const moduleIds = modules.map((m) => m._id);

    const enrollments = await this.enrollmentModel
      .find({
        studentId: new Types.ObjectId(studentId),
        moduleId: { $in: moduleIds },
        $or: [{ isCompleted: true }, { progress: 100 }],
      })
      .lean();

    const moduleData = enrollments.map((e) => {
      const mod = moduleMap.get((e.moduleId as any).toString()) as any;
      const rawLessons: any[] = mod?.lessons || [];
      const lessons = rawLessons.map((lesson: any, idx: number) => {
        const lp = ((e as any).lessonProgress || []).find((p: any) => p.lessonIndex === idx);
        return { title: lesson.title || `Lesson ${idx + 1}`, isCompleted: lp?.isCompleted || false };
      });
      return { title: mod?.title || 'Unknown Module', completedDate: (e as any).completedAt, lessons };
    });

    return this.buildTranscriptPDF(studentName, level, new Date(), moduleData);
  }

  private buildTranscriptPDF(
    studentName: string,
    level: string,
    issuedDate: Date,
    modules: { title: string; completedDate?: Date; lessons: { title: string; isCompleted: boolean }[] }[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 55, bottom: 55, left: 55, right: 55 } });
      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const primary = '#021d49';
      const teal = '#00c4b3';
      const W = doc.page.width - 110;

      // Header bar
      doc.rect(0, 0, doc.page.width, 80).fill(primary);
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#ffffff')
        .text('ARIN PUBLISHING ACADEMY', 55, 22, { width: W });
      doc.fontSize(11).font('Helvetica').fillColor(teal)
        .text('Academic Transcript', 55, 50);

      // Title
      doc.moveDown(2);
      doc.fontSize(18).font('Helvetica-Bold').fillColor(primary)
        .text('TRANSCRIPT OF ACHIEVEMENT', { align: 'center' });
      doc.moveDown(0.4);
      doc.moveTo(55, doc.y).lineTo(55 + W, doc.y).lineWidth(2).strokeColor(teal).stroke();
      doc.moveDown(0.6);

      // Student info box
      const boxY = doc.y;
      doc.rect(55, boxY, W, 56).fill('#f0f9ff');
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Student Name', 70, boxY + 10);
      doc.fontSize(14).font('Helvetica-Bold').fillColor(primary).text(studentName, 70, boxY + 24);
      const lvlLabel = level.charAt(0).toUpperCase() + level.slice(1);
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
        .text(`Level: ${lvlLabel}   |   Issued: ${issuedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, 70, boxY + 44);
      doc.y = boxY + 66;
      doc.moveDown(0.8);

      // Modules
      doc.fontSize(12).font('Helvetica-Bold').fillColor(primary).text('MODULES COMPLETED');
      doc.moveDown(0.4);

      modules.forEach((mod, mi) => {
        if (doc.y > doc.page.height - 120) doc.addPage();

        // Module row
        const mY = doc.y;
        doc.rect(55, mY, W, 26).fill(mi % 2 === 0 ? '#f8fafc' : '#ffffff');
        doc.circle(66, mY + 13, 7).fill(teal);
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
          .text(String(mi + 1), 62, mY + 8, { width: 8, align: 'center' });
        doc.fontSize(11).font('Helvetica-Bold').fillColor(primary)
          .text(mod.title, 80, mY + 8, { width: W - 30 });
        if (mod.completedDate) {
          doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
            .text(new Date(mod.completedDate).toLocaleDateString('en-GB'), 55, mY + 8, { width: W, align: 'right' });
        }
        doc.y = mY + 30;

        // Lessons
        mod.lessons.forEach((ls) => {
          if (doc.y > doc.page.height - 80) doc.addPage();
          const lY = doc.y;
          const checkColor = ls.isCompleted ? '#16a34a' : '#d1d5db';
          doc.circle(76, lY + 7, 4).fill(checkColor);
          doc.fontSize(9).font('Helvetica').fillColor(ls.isCompleted ? '#374151' : '#9ca3af')
            .text(ls.title, 86, lY + 2, { width: W - 40 });
          doc.y = lY + 16;
        });
        doc.moveDown(0.3);
      });

      // Footer
      const fY = doc.page.height - 50;
      doc.moveTo(55, fY - 10).lineTo(55 + W, fY - 10).lineWidth(1).strokeColor('#e5e7eb').stroke();
      doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
        .text('This transcript is an official record issued by Arin Publishing Academy.', 55, fY, { width: W, align: 'center' });

      doc.end();
    });
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
      doc
        .rect(40, 40, cornerSize, cornerSize)
        .strokeColor(secondaryColor2)
        .lineWidth(2)
        .stroke();
      doc
        .rect(pageWidth - 40 - cornerSize, 40, cornerSize, cornerSize)
        .strokeColor(secondaryColor2)
        .lineWidth(2)
        .stroke();
      doc
        .rect(40, pageHeight - 40 - cornerSize, cornerSize, cornerSize)
        .strokeColor(secondaryColor2)
        .lineWidth(2)
        .stroke();
      doc
        .rect(
          pageWidth - 40 - cornerSize,
          pageHeight - 40 - cornerSize,
          cornerSize,
          cornerSize,
        )
        .strokeColor(secondaryColor2)
        .lineWidth(2)
        .stroke();

      // Logo
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, pageWidth / 2 - 60, 52, {
          width: 120,
          height: 60,
          fit: [120, 60],
        });
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
      const levelLabel =
        (certificate.moduleLevel || 'beginner').charAt(0).toUpperCase() +
        (certificate.moduleLevel || 'beginner').slice(1);
      doc
        .fontSize(14)
        .font('Helvetica')
        .fillColor(secondaryColor2)
        .text(
          `Level: ${levelLabel}  |  Category: ${certificate.categoryName}`,
          0,
          courseBoxY + 70,
          {
            align: 'center',
            width: pageWidth,
          },
        );

      // Score badge
      if (certificate.scoreAchieved) {
        const badgeX = pageWidth / 2 - 60;
        const badgeY = 440;

        doc
          .circle(badgeX + 60, badgeY + 20, 35)
          .fillAndStroke(secondaryColor1, secondaryColor2);

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
      const dateStr = new Date(certificate.issuedDate).toLocaleDateString(
        'en-US',
        {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        },
      );

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
      doc
        .moveTo(leftSigX, sigY)
        .lineTo(leftSigX + 180, sigY)
        .strokeColor('#374151')
        .lineWidth(1.5)
        .stroke();
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(certificate.instructorName, leftSigX, sigY + 10, {
          width: 180,
          align: 'center',
        });
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Instructor Signature', leftSigX, sigY + 28, {
          width: 180,
          align: 'center',
        });

      // Date line
      doc
        .moveTo(rightSigX, sigY)
        .lineTo(rightSigX + 180, sigY)
        .strokeColor('#374151')
        .lineWidth(1.5)
        .stroke();
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(dateStr, rightSigX, sigY + 10, { width: 180, align: 'center' });
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Date Issued', rightSigX, sigY + 28, {
          width: 180,
          align: 'center',
        });

      // Footer
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(secondaryColor2)
        .text(
          'Arin in collaboration with Taylor & Francis',
          0,
          pageHeight - 88,
          { align: 'center', width: pageWidth },
        );
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#9ca3af')
        .text(
          `Certificate ID: ${certificate.certificateNumber}`,
          0,
          pageHeight - 70,
          { align: 'center', width: pageWidth },
        );
      doc
        .fontSize(11)
        .fillColor('#6b7280')
        .text(
          'This certificate validates the successful completion of the module requirements',
          0,
          pageHeight - 50,
          { align: 'center', width: pageWidth },
        );

      // Verified seal
      const sealX = pageWidth - 120;
      const sealY = pageHeight - 160;
      doc.circle(sealX, sealY, 45).fillAndStroke(secondaryColor2, primaryColor);
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#ffffff')
        .text('VERIFIED', sealX - 30, sealY - 20, {
          width: 60,
          align: 'center',
        });
      doc.fontSize(8).text('CERTIFICATE', sealX - 30, sealY - 5, {
        width: 60,
        align: 'center',
      });

      doc.end();
    });
  }
}
