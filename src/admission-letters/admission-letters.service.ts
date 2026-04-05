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
import type { Response } from 'express';
import * as https from 'https';
import * as http from 'http';
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
      originalFileName: dto.originalFileName ?? '',
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

    const query: any = { userType: 'fellow' };

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
        .select('firstName lastName fullName email fellowData isActive')
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
        userType: 'fellow',
      })
      .select('email firstName lastName fullName')
      .lean();

    if (fellows.length === 0) {
      throw new BadRequestException('No valid fellows found for the given IDs');
    }

    const recipients = fellows.map((f: any) => {
      const name =
        [f.firstName, f.lastName].filter(Boolean).join(' ').trim() ||
        f.fullName ||
        f.email;
      return {
        fellowId: f._id,
        email: f.email,
        name,
        status: RecipientStatus.PENDING,
        trackingToken: randomUUID(),
      };
    });

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
      this.configService.get('BACKEND_URL') || 'http://localhost:5000';
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

          // Personalize bodyHtml: replace {{name}} and {{firstName}} placeholders
          const firstName = recipient.name?.split(' ')[0] || recipient.name;
          const personalizedBody = (dto.bodyHtml || '').replace(
            /\{\{name\}\}/gi,
            recipient.name,
          ).replace(
            /\{\{firstName\}\}/gi,
            firstName,
          );

          const viewUrl = `${backendUrl}/api/admission-letters/view/${sendRecord.templateId}`;
          const ext =
            (template.originalFileName || template.pdfUrl)
              .split('.')
              .pop()
              ?.toLowerCase() || 'pdf';
          const attachmentName = `${template.name}.${ext}`;

          const html = this.buildEmailHtml({
            recipientName: recipient.name,
            viewUrl,
            bodyHtml: personalizedBody,
            signOffName: dto.signOffName,
            signOffTitle: dto.signOffTitle,
            acknowledgeUrl,
            pixelUrl,
          });

          // Gmail SMTP requires the envelope sender to match the authenticated
          // account. Use the SMTP from-email as the actual sender and set the
          // admin's chosen address as Reply-To so replies go to the right place.
          const smtpFromEmail =
            this.configService.get('SMTP_FROM_EMAIL') || dto.fromEmail;
          const envelopeFrom = `"${dto.fromName}" <${smtpFromEmail}>`;

          try {
            const result = await this.emailService.sendAdmissionLetter({
              from: envelopeFrom,
              replyTo: dto.fromEmail !== smtpFromEmail ? dto.fromEmail : undefined,
              to: recipient.email,
              cc: dto.ccEmails ?? [],
              subject: dto.subject,
              html,
              pdfUrl: template.pdfUrl,
              pdfName: attachmentName,
            });

            if (result.success) {
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
            } else {
              await this.sendModel.updateOne(
                {
                  _id: sendRecord._id,
                  'recipients.trackingToken': recipient.trackingToken,
                },
                {
                  $set: {
                    'recipients.$.status': RecipientStatus.FAILED,
                    'recipients.$.errorMessage': result.message || 'Send failed',
                  },
                },
              );
              failureCount++;
              this.logger.error(
                `Failed to send to ${recipient.email}: ${result.message}`,
              );
            }
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
    viewUrl: string;
    bodyHtml?: string;
    signOffName: string;
    signOffTitle: string;
    acknowledgeUrl: string;
    pixelUrl: string;
  }) {
    const {
      recipientName,
      viewUrl,
      bodyHtml,
      signOffName,
      signOffTitle,
      acknowledgeUrl,
      pixelUrl,
    } = params;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Admission Letter — Arin Fellowship</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Georgia,'Times New Roman',serif;-webkit-text-size-adjust:100%;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f4f5f7;padding:48px 16px;">
  <tr>
    <td align="center">

      <!-- Outer card -->
      <table role="presentation" width="580" cellpadding="0" cellspacing="0"
             style="max-width:580px;width:100%;background:#ffffff;
                    box-shadow:0 2px 16px rgba(0,0,0,0.09);">

        <!-- Top rule -->
        <tr>
          <td style="height:5px;background:#1a3a6b;font-size:0;line-height:0;">&nbsp;</td>
        </tr>

        <!-- Header -->
        <tr>
          <td style="padding:32px 48px 24px;border-bottom:1px solid #e8e8e8;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;
                             font-weight:700;letter-spacing:2.5px;color:#1a3a6b;
                             text-transform:uppercase;">
                    Africa Research &amp; Impact Network
                  </p>
                  <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:11px;
                             color:#888888;letter-spacing:0.5px;">
                    Arin Fellowship Programme &nbsp;&mdash;&nbsp; Official Communication
                  </p>
                </td>
                <td align="right" style="vertical-align:top;">
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;
                             color:#aaaaaa;">
                    ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Salutation & body -->
        <tr>
          <td style="padding:36px 48px 0;">
            <p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:15px;
                       color:#222222;line-height:1.6;">
              Dear <strong>${recipientName}</strong>,
            </p>

            <p style="margin:0 0 18px;font-size:15px;color:#333333;line-height:1.8;">
              We are pleased to inform you that your admission to the
              <strong>Arin Fellowship Programme</strong> has been confirmed.
              Please find your official admission letter attached to this email.
            </p>

            ${bodyHtml ? `<p style="margin:0 0 18px;font-size:15px;color:#333333;line-height:1.8;">${bodyHtml}</p>` : ''}

            <p style="margin:0 0 18px;font-size:15px;color:#333333;line-height:1.8;">
              You may view or download your letter at any time using the button below.
            </p>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td style="padding:28px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#1a3a6b;border-radius:3px;">
                  <a href="${viewUrl}" target="_blank"
                     style="display:inline-block;padding:13px 36px;color:#ffffff;
                            text-decoration:none;font-family:Arial,sans-serif;
                            font-size:14px;font-weight:600;letter-spacing:0.5px;">
                    View Admission Letter
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#999999;">
              The letter is also attached to this email as a PDF for your records.
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="height:1px;background:#e8e8e8;font-size:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- Acknowledge -->
        <tr>
          <td style="padding:28px 48px;">
            <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:14px;
                       color:#333333;line-height:1.6;">
              Kindly confirm that you have received this letter by clicking below.
              This helps us ensure all fellows have been successfully notified.
            </p>
            <p style="margin:16px 0 0;">
              <a href="${acknowledgeUrl}"
                 style="font-family:Arial,sans-serif;font-size:13px;color:#1a3a6b;
                        font-weight:600;text-decoration:underline;">
                Confirm receipt of this letter &rarr;
              </a>
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="height:1px;background:#e8e8e8;font-size:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding:28px 48px 36px;">
            <p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.8;">
              Yours sincerely,
            </p>
            <p style="margin:0 0 2px;font-size:15px;color:#111111;font-weight:bold;
                       font-family:Arial,sans-serif;">
              ${signOffName}
            </p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#666666;">
              ${signOffTitle}
            </p>
            <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#666666;">
              Africa Research &amp; Impact Network (ARIN)
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f8f8;border-top:1px solid #e8e8e8;
                     padding:20px 48px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;
                       color:#999999;line-height:1.8;text-align:center;">
              ACK Gardens Plaza, 1st Floor, Upperhill &mdash; Nairobi, Kenya
              &nbsp;&nbsp;|&nbsp;&nbsp;
              P.O. Box 53358&#8209;00200
              &nbsp;&nbsp;|&nbsp;&nbsp;
              <a href="mailto:info@arin-africa.org"
                 style="color:#999999;text-decoration:none;">info@arin-africa.org</a>
              &nbsp;&nbsp;|&nbsp;&nbsp;
              <a href="https://www.arin-africa.org"
                 style="color:#999999;text-decoration:none;">www.arin-africa.org</a>
              <br/>
              This is an official communication. Please do not reply to this email.
            </p>
          </td>
        </tr>

        <!-- Bottom rule -->
        <tr>
          <td style="height:5px;background:#1a3a6b;font-size:0;line-height:0;">&nbsp;</td>
        </tr>

      </table>

    </td>
  </tr>
</table>

<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt=""/>

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

  async deleteLog(id: string) {
    const log = await this.sendModel.findByIdAndDelete(id);
    if (!log) throw new NotFoundException('Send log not found');
    return { success: true, message: 'Log deleted' };
  }

  async getLogDetail(id: string) {
    const log = await this.sendModel
      .findById(id)
      .populate('templateId', 'name pdfUrl originalFileName')
      .populate('sentBy', 'firstName lastName email')
      .populate('signedOffBy', 'firstName lastName email')
      .lean();

    if (!log) throw new NotFoundException('Send log not found');
    return { success: true, log };
  }

  // ─── Inline file viewer proxy ─────────────────────────────────────────────
  // Fetches the file from Cloudinary and serves it with Content-Disposition:
  // inline so the browser opens it instead of downloading it.

  async streamTemplate(templateId: string, res: Response): Promise<void> {
    const template = await this.templateModel.findById(templateId).lean();
    if (!template) {
      res.status(404).json({ message: 'Template not found' });
      return;
    }

    const ext =
      (template.originalFileName || template.pdfUrl)
        .split('.')
        .pop()
        ?.toLowerCase() || 'pdf';

    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    const contentType = mimeMap[ext] ?? 'application/octet-stream';
    const fileName = encodeURIComponent(`${template.name}.${ext}`);

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${template.name}.${ext}"; filename*=UTF-8''${fileName}`,
      'Cache-Control': 'private, max-age=3600',
    });

    // Pipe the Cloudinary file through this endpoint so the browser receives
    // it with the correct headers instead of Cloudinary's attachment headers.
    await new Promise<void>((resolve, reject) => {
      const url = new URL(template.pdfUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      protocol
        .get(template.pdfUrl, (fileRes) => {
          // Follow one level of redirect (Cloudinary sometimes 301s)
          if (
            fileRes.statusCode &&
            fileRes.statusCode >= 300 &&
            fileRes.statusCode < 400 &&
            fileRes.headers.location
          ) {
            const redirectUrl = fileRes.headers.location;
            const rProtocol = redirectUrl.startsWith('https') ? https : http;
            rProtocol
              .get(redirectUrl, (rRes) => {
                rRes.pipe(res);
                rRes.on('end', resolve);
                rRes.on('error', reject);
              })
              .on('error', reject);
            return;
          }

          fileRes.pipe(res);
          fileRes.on('end', resolve);
          fileRes.on('error', reject);
        })
        .on('error', (err) => {
          this.logger.error('Failed to proxy template file', err);
          reject(err);
        });
    });
  }
}
