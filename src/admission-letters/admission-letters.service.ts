import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  AdmissionLetterTemplate,
  AdmissionLetterTemplateDocument,
} from '../schemas/admission-letter-template.schema';
import {
  AdmissionLetterSend,
  AdmissionLetterSendDocument,
  RecipientStatus,
} from '../schemas/admission-letter-send.schema';
import {
  AdminFromEmail,
  AdminFromEmailDocument,
} from '../schemas/admin-from-email.schema';
import { User } from '../schemas/user.schema';
import { EmailService } from '../common/services/email.service';
import {
  SavePdfTemplateDto,
  CreateFromEmailDto,
  SendAdmissionLettersDto,
} from './dto/admission-letter.dto';

@Injectable()
export class AdmissionLettersService {
  private readonly logger = new Logger(AdmissionLettersService.name);

  constructor(
    @InjectModel(AdmissionLetterTemplate.name)
    private templateModel: Model<AdmissionLetterTemplateDocument>,
    @InjectModel(AdmissionLetterSend.name)
    private sendModel: Model<AdmissionLetterSendDocument>,
    @InjectModel(AdminFromEmail.name)
    private fromEmailModel: Model<AdminFromEmailDocument>,
    @InjectModel(User.name)
    private userModel: Model<any>,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  // ─── PDF Templates ────────────────────────────────────────────────────────

  async saveTemplate(dto: SavePdfTemplateDto, adminId: string) {
    const template = await this.templateModel.create({
      name: dto.name,
      pdfUrl: dto.pdfUrl,
      pdfPublicId: dto.pdfPublicId,
      uploadedBy: new Types.ObjectId(adminId),
    });
    return { success: true, template };
  }

  async listTemplates() {
    const templates = await this.templateModel
      .find()
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'firstName lastName email')
      .lean();
    return { success: true, templates };
  }

  async deleteTemplate(id: string) {
    const template = await this.templateModel.findByIdAndDelete(id);
    if (!template) throw new NotFoundException('Template not found');
    return { success: true, message: 'Template deleted' };
  }

  // ─── Sender Email Addresses ───────────────────────────────────────────────

  async listFromEmails() {
    const emails = await this.fromEmailModel
      .find({ isActive: true })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();
    return { success: true, emails };
  }

  async addFromEmail(dto: CreateFromEmailDto, adminId: string) {
    const existing = await this.fromEmailModel.findOne({ email: dto.email });
    if (existing) {
      throw new BadRequestException('This email address already exists');
    }

    // If new one is default, clear previous default
    if (dto.isDefault) {
      await this.fromEmailModel.updateMany({}, { isDefault: false });
    }

    const fromEmail = await this.fromEmailModel.create({
      email: dto.email,
      displayName: dto.displayName,
      isDefault: dto.isDefault ?? false,
      addedBy: new Types.ObjectId(adminId),
    });
    return { success: true, fromEmail };
  }

  async removeFromEmail(id: string) {
    const record = await this.fromEmailModel.findByIdAndUpdate(id, {
      isActive: false,
    });
    if (!record) throw new NotFoundException('From-email not found');
    return { success: true, message: 'Email address removed' };
  }

  // ─── Fellow Listing (for recipient selection) ─────────────────────────────

  async getFellows(filters: {
    search?: string;
    categoryId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      search,
      categoryId,
      status,
      page = 1,
      limit = 50,
    } = filters;

    const query: any = { userType: 'FELLOW' };

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { 'fellowData.fellowId': regex },
        { 'fellowData.cohort': regex },
      ];
    }

    if (categoryId) {
      query['fellowData.assignedCategories'] = new Types.ObjectId(categoryId);
    }

    if (status && status !== 'all') {
      query['fellowData.fellowshipStatus'] = status.toUpperCase();
    }

    const skip = (page - 1) * limit;
    const [fellows, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('firstName lastName email fellowData isActive')
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    return {
      success: true,
      fellows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ─── Bulk Send ────────────────────────────────────────────────────────────

  async sendBulk(dto: SendAdmissionLettersDto, adminId: string) {
    const template = await this.templateModel.findById(dto.templateId).lean();
    if (!template) throw new NotFoundException('PDF template not found');

    const fellows = await this.userModel
      .find({
        _id: { $in: dto.recipientIds.map((id) => new Types.ObjectId(id)) },
        userType: 'FELLOW',
      })
      .select('email firstName lastName')
      .lean();

    if (fellows.length === 0) {
      throw new BadRequestException('No valid fellows found for the given IDs');
    }

    const recipients = fellows.map((f: any) => ({
      fellowId: f._id,
      email: f.email,
      name: `${f.firstName} ${f.lastName}`,
      status: RecipientStatus.PENDING,
      trackingToken: randomUUID(),
    }));

    const sendRecord = await this.sendModel.create({
      templateId: new Types.ObjectId(dto.templateId),
      subject: dto.subject,
      bodyHtml: dto.bodyHtml ?? '',
      fromEmail: dto.fromEmail,
      fromName: dto.fromName,
      ccEmails: dto.ccEmails ?? [],
      signOffName: dto.signOffName,
      signOffTitle: dto.signOffTitle,
      signedOffBy: new Types.ObjectId(adminId),
      signedOffAt: new Date(),
      recipients,
      totalRecipients: fellows.length,
      sentBy: new Types.ObjectId(adminId),
    });

    // Fire and forget — don't block the HTTP response
    this.processEmailQueue(sendRecord, template, dto).catch((err) =>
      this.logger.error('Bulk admission letter send failed', err),
    );

    return {
      success: true,
      message: 'Sending in progress',
      sendId: sendRecord._id,
      totalRecipients: fellows.length,
    };
  }

  private async processEmailQueue(
    sendRecord: AdmissionLetterSendDocument,
    template: any,
    dto: SendAdmissionLettersDto,
  ) {
    const BATCH_SIZE = 10;
    let successCount = 0;
    let failureCount = 0;
    const backendUrl =
      this.configService.get('BACKEND_URL') || 'http://localhost:3001';
    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:3000';

    for (
      let i = 0;
      i < sendRecord.recipients.length;
      i += BATCH_SIZE
    ) {
      const batch = sendRecord.recipients.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (recipient: any) => {
          const acknowledgeUrl = `${frontendUrl}/acknowledge/${recipient.trackingToken}`;
          const pixelUrl = `${backendUrl}/api/admission-letters/track/${recipient.trackingToken}/pixel.png`;

          const html = this.buildEmailHtml({
            recipientName: recipient.name,
            pdfUrl: template.pdfUrl,
            bodyHtml: dto.bodyHtml,
            signOffName: dto.signOffName,
            signOffTitle: dto.signOffTitle,
            acknowledgeUrl,
            pixelUrl,
          });

          try {
            await this.emailService.sendAdmissionLetter({
              from: `"${dto.fromName}" <${dto.fromEmail}>`,
              to: recipient.email,
              cc: dto.ccEmails ?? [],
              subject: dto.subject,
              html,
              pdfUrl: template.pdfUrl,
              pdfName: `${template.name}.pdf`,
            });

            await this.sendModel.updateOne(
              {
                _id: sendRecord._id,
                'recipients.trackingToken': recipient.trackingToken,
              },
              {
                $set: {
                  'recipients.$.status': RecipientStatus.SENT,
                  'recipients.$.sentAt': new Date(),
                },
              },
            );
            successCount++;
          } catch (err: any) {
            await this.sendModel.updateOne(
              {
                _id: sendRecord._id,
                'recipients.trackingToken': recipient.trackingToken,
              },
              {
                $set: {
                  'recipients.$.status': RecipientStatus.FAILED,
                  'recipients.$.errorMessage': err?.message || 'Unknown error',
                },
              },
            );
            failureCount++;
            this.logger.error(
              `Failed to send to ${recipient.email}: ${err?.message}`,
            );
          }
        }),
      );

      // Respect SMTP rate limits
      if (i + BATCH_SIZE < sendRecord.recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    await this.sendModel.findByIdAndUpdate(sendRecord._id, {
      successCount,
      failureCount,
    });

    this.logger.log(
      `Admission letter send complete — success: ${successCount}, failed: ${failureCount}`,
    );
  }

  private buildEmailHtml(params: {
    recipientName: string;
    pdfUrl: string;
    bodyHtml?: string;
    signOffName: string;
    signOffTitle: string;
    acknowledgeUrl: string;
    pixelUrl: string;
  }) {
    const {
      recipientName,
      pdfUrl,
      bodyHtml,
      signOffName,
      signOffTitle,
      acknowledgeUrl,
      pixelUrl,
    } = params;

    return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1a56db;padding:28px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">
              Arin Fellowship Program
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;color:#111827;font-size:15px;">Dear <strong>${recipientName}</strong>,</p>
            <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
              We are pleased to share your admission letter for the Arin Fellowship Program.
              Please find it attached to this email or click the button below to view it online.
            </p>

            ${
              bodyHtml
                ? `<div style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${bodyHtml}</div>`
                : ''
            }

            <!-- View PDF Button -->
            <div style="text-align:center;margin:28px 0;">
              <a href="${pdfUrl}"
                 style="display:inline-block;background:#1a56db;color:#ffffff;padding:13px 32px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:600;">
                View Admission Letter
              </a>
            </div>

            <p style="margin:0 0 28px;color:#6b7280;font-size:13px;text-align:center;">
              The PDF is also attached to this email for your records.
            </p>

            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 28px;"/>

            <!-- Acknowledge Button -->
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;text-align:center;margin-bottom:28px;">
              <p style="margin:0 0 12px;color:#166534;font-size:14px;font-weight:600;">
                Please confirm you have received this letter
              </p>
              <a href="${acknowledgeUrl}"
                 style="display:inline-block;background:#16a34a;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
                Acknowledge Receipt
              </a>
            </div>

            <!-- Sign-off -->
            <p style="margin:0;color:#374151;font-size:15px;line-height:1.8;">
              Warm regards,<br/>
              <strong style="color:#111827;">${signOffName}</strong><br/>
              <span style="color:#6b7280;font-size:13px;">${signOffTitle}</span>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              This is an official communication from the Arin Fellowship Program.
              Please do not reply to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
  <!-- Tracking pixel -->
  <img src="${pixelUrl}" width="1" height="1" style="display:none;width:1px;height:1px;" alt=""/>
</body>
</html>`;
  }

  // ─── Tracking ─────────────────────────────────────────────────────────────

  async recordOpen(trackingToken: string) {
    try {
      const send = await this.sendModel.findOne({
        'recipients.trackingToken': trackingToken,
        'recipients.status': { $in: [RecipientStatus.SENT] },
      });

      if (!send) return;

      await this.sendModel.updateOne(
        {
          _id: send._id,
          'recipients.trackingToken': trackingToken,
          'recipients.openedAt': { $exists: false },
        },
        {
          $set: {
            'recipients.$.status': RecipientStatus.OPENED,
            'recipients.$.openedAt': new Date(),
          },
          $inc: { openedCount: 1 },
        },
      );
    } catch (err) {
      this.logger.error('Error recording open', err);
    }
  }

  async recordAcknowledgement(trackingToken: string) {
    try {
      const send = await this.sendModel.findOne({
        'recipients.trackingToken': trackingToken,
      });

      if (!send) {
        return { success: false, message: 'Invalid token' };
      }

      const recipient = send.recipients.find(
        (r: any) => r.trackingToken === trackingToken,
      );
      if (!recipient) return { success: false, message: 'Invalid token' };

      if (recipient.acknowledgedAt) {
        return { success: true, message: 'Already acknowledged', alreadyDone: true };
      }

      await this.sendModel.updateOne(
        {
          _id: send._id,
          'recipients.trackingToken': trackingToken,
        },
        {
          $set: {
            'recipients.$.status': RecipientStatus.ACKNOWLEDGED,
            'recipients.$.acknowledgedAt': new Date(),
          },
          $inc: { acknowledgedCount: 1 },
        },
      );

      return {
        success: true,
        message: 'Receipt acknowledged successfully',
        recipientName: recipient.name,
      };
    } catch (err) {
      this.logger.error('Error recording acknowledgement', err);
      return { success: false, message: 'An error occurred' };
    }
  }

  // ─── Logs ─────────────────────────────────────────────────────────────────

  async getLogs(filters: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.sendModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('templateId', 'name pdfUrl')
        .populate('sentBy', 'firstName lastName email')
        .select('-recipients')
        .lean(),
      this.sendModel.countDocuments(),
    ]);

    return {
      success: true,
      logs,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getLogDetail(id: string) {
    const log = await this.sendModel
      .findById(id)
      .populate('templateId', 'name pdfUrl')
      .populate('sentBy', 'firstName lastName email')
      .populate('signedOffBy', 'firstName lastName email')
      .lean();

    if (!log) throw new NotFoundException('Send log not found');
    return { success: true, log };
  }
}
