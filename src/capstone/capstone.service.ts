import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Capstone, CapstoneDocument } from './capstone.schema';
import { CloudinaryService } from '../common/services/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../common/services/email.service';
import { NotificationType } from '../schemas/notification.schema';
import { User } from '../schemas/user.schema';

const MAX_REVISIONS = 2;

@Injectable()
export class CapstoneService {
  constructor(
    @InjectModel(Capstone.name) private capstoneModel: Model<CapstoneDocument>,
    @InjectModel(User.name) private userModel: Model<any>,
    private cloudinaryService: CloudinaryService,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
  ) {}

  // ── Student ────────────────────────────────────────────────────────────────

  async getMyCapstone(studentId: string) {
    const capstone = await this.capstoneModel
      .findOne({ studentId: new Types.ObjectId(studentId) })
      .sort({ createdAt: -1 })
      .lean();
    return { success: true, data: capstone };
  }

  async submitProposal(
    studentId: string,
    studentName: string,
    studentEmail: string,
    title: string,
    description: string,
    files: Express.Multer.File[],
  ) {
    if (!title?.trim()) throw new BadRequestException('Project title is required');
    if (!description || description === '<p><br></p>') {
      throw new BadRequestException('Project description is required');
    }

    // Block if there is already an active (non-terminal) capstone
    const existing = await this.capstoneModel.findOne({
      studentId: new Types.ObjectId(studentId),
      status: { $nin: ['rejected', 'completed'] },
    });
    if (existing) {
      throw new BadRequestException(
        'You already have an active capstone submission. You cannot start a new one until the current one is completed or rejected.',
      );
    }

    const uploadedFiles = await this.uploadFiles(files);

    const capstone = new this.capstoneModel({
      studentId: new Types.ObjectId(studentId),
      studentName,
      studentEmail,
      title: title.trim(),
      description,
      files: uploadedFiles,
      status: 'submitted',
      revisionCount: 0,
      submittedAt: new Date(),
    });

    await capstone.save();

    // Notify all instructors and admins (fire-and-forget)
    this.notifyStaff(
      NotificationType.CAPSTONE_SUBMITTED,
      'New Capstone Submission',
      `${studentName} submitted a capstone proposal: "${title.trim()}"`,
      `/admin/capstone/${capstone._id}`,
      capstone._id as Types.ObjectId,
    ).catch(() => {});

    return { success: true, message: 'Proposal submitted successfully', data: capstone };
  }

  async resubmitRevision(
    capstoneId: string,
    studentId: string,
    title: string,
    description: string,
    files: Express.Multer.File[],
  ) {
    const capstone = await this.findOwnedCapstone(capstoneId, studentId);

    if (capstone.status !== 'revision_requested') {
      throw new BadRequestException('Capstone is not awaiting a revision');
    }
    if (capstone.revisionCount >= MAX_REVISIONS) {
      throw new BadRequestException('All revision attempts have been used');
    }
    if (!title?.trim()) throw new BadRequestException('Project title is required');

    // Use newly uploaded files, or keep the previous ones if none supplied
    const uploadedFiles =
      files.length > 0 ? await this.uploadFiles(files) : (capstone.files as any);

    capstone.title = title.trim();
    capstone.description = description;
    capstone.files = uploadedFiles;
    capstone.status = 'submitted';
    capstone.instructorComment = '';
    capstone.submittedAt = new Date();

    await capstone.save();

    // Notify staff of resubmission (fire-and-forget)
    this.notifyStaff(
      NotificationType.CAPSTONE_SUBMITTED,
      'Capstone Revision Resubmitted',
      `${capstone.studentName} resubmitted their capstone after revision: "${capstone.title}"`,
      `/admin/capstone/${capstone._id}`,
      capstone._id as Types.ObjectId,
    ).catch(() => {});

    return { success: true, message: 'Revision submitted successfully', data: capstone };
  }

  async submitImplementation(
    capstoneId: string,
    studentId: string,
    files: Express.Multer.File[],
    notes: string,
  ) {
    const capstone = await this.findOwnedCapstone(capstoneId, studentId);

    if (!['approved', 'implementation'].includes(capstone.status)) {
      throw new BadRequestException(
        'Your proposal must be approved before submitting the implementation',
      );
    }
    if (files.length === 0) {
      throw new BadRequestException('At least one implementation file is required');
    }

    const uploadedFiles = await this.uploadFiles(files);

    capstone.implementationFiles = uploadedFiles as any;
    capstone.implementationNotes = notes || '';
    capstone.status = 'implementation_submitted';
    capstone.implementationSubmittedAt = new Date();

    await capstone.save();

    // Notify staff of implementation submission (fire-and-forget)
    this.notifyStaff(
      NotificationType.CAPSTONE_SUBMITTED,
      'Capstone Implementation Submitted',
      `${capstone.studentName} submitted their final implementation for: "${capstone.title}"`,
      `/admin/capstone/${capstone._id}`,
      capstone._id as Types.ObjectId,
    ).catch(() => {});

    return {
      success: true,
      message: 'Implementation submitted successfully',
      data: capstone,
    };
  }

  async withdrawCapstone(capstoneId: string, studentId: string) {
    const capstone = await this.findOwnedCapstone(capstoneId, studentId);

    const withdrawable = ['submitted', 'revision_requested'];
    if (!withdrawable.includes(capstone.status)) {
      throw new BadRequestException(
        'You can only withdraw a submission that is pending review or awaiting revision.',
      );
    }

    await this.capstoneModel.findByIdAndDelete(capstoneId);
    return { success: true, message: 'Submission withdrawn successfully' };
  }

  // ── Instructor / Admin ─────────────────────────────────────────────────────

  async getAllCapstones(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, search, page = 1, limit = 50 } = filters;
    const query: any = {};

    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { studentName: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { studentEmail: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.capstoneModel
        .find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.capstoneModel.countDocuments(query),
    ]);

    return { success: true, data, total, page, limit };
  }

  async getCapstoneById(id: string) {
    const capstone = await this.capstoneModel.findById(id).lean();
    if (!capstone) throw new NotFoundException('Capstone not found');
    return { success: true, data: capstone };
  }

  async approveProposal(id: string, comment: string) {
    const capstone = await this.findCapstone(id);

    if (!['submitted', 'under_review'].includes(capstone.status)) {
      throw new BadRequestException(
        `Cannot approve a capstone with status "${capstone.status}"`,
      );
    }

    capstone.status = 'approved';
    capstone.approvedAt = new Date();

    if (comment) {
      capstone.instructorComment = comment;
      this.pushComment(capstone, 'instructor', comment);
    }

    await capstone.save();

    // Notify student (fire-and-forget)
    this.notifyStudent(
      capstone.studentId.toString(),
      capstone.studentEmail,
      capstone.studentName,
      NotificationType.CAPSTONE_STATUS_UPDATED,
      'Capstone Proposal Approved',
      `Your capstone proposal "${capstone.title}" has been approved! You can now submit your final implementation.`,
      `/capstone`,
      capstone._id as Types.ObjectId,
      this.buildApprovalEmail(capstone.studentName, capstone.title, comment),
    ).catch(() => {});

    return { success: true, message: 'Proposal approved', data: capstone };
  }

  async requestRevision(id: string, comment: string) {
    if (!comment?.trim()) {
      throw new BadRequestException('A comment explaining the required changes is required');
    }

    const capstone = await this.findCapstone(id);

    if (!['submitted', 'under_review'].includes(capstone.status)) {
      throw new BadRequestException(
        `Cannot request a revision on a capstone with status "${capstone.status}"`,
      );
    }
    if (capstone.revisionCount >= MAX_REVISIONS) {
      throw new BadRequestException(
        'Maximum revision limit reached. Please reject or approve this capstone.',
      );
    }

    capstone.status = 'revision_requested';
    capstone.revisionCount += 1;
    capstone.instructorComment = comment;
    this.pushComment(capstone, 'instructor', comment);

    await capstone.save();

    // Notify student (fire-and-forget)
    this.notifyStudent(
      capstone.studentId.toString(),
      capstone.studentEmail,
      capstone.studentName,
      NotificationType.CAPSTONE_STATUS_UPDATED,
      'Capstone Revision Requested',
      `Your capstone proposal "${capstone.title}" needs revision. Please check the feedback and resubmit.`,
      `/capstone`,
      capstone._id as Types.ObjectId,
      this.buildRevisionEmail(capstone.studentName, capstone.title, comment, capstone.revisionCount),
    ).catch(() => {});

    return { success: true, message: 'Revision requested', data: capstone };
  }

  async rejectCapstone(id: string, comment: string) {
    const capstone = await this.findCapstone(id);

    if (['graded', 'completed'].includes(capstone.status)) {
      throw new BadRequestException('Cannot reject an already graded capstone');
    }

    capstone.status = 'rejected';
    capstone.instructorComment = comment || '';
    if (comment) this.pushComment(capstone, 'instructor', comment);

    await capstone.save();

    // Notify student (fire-and-forget)
    this.notifyStudent(
      capstone.studentId.toString(),
      capstone.studentEmail,
      capstone.studentName,
      NotificationType.CAPSTONE_STATUS_UPDATED,
      'Capstone Submission Rejected',
      `Your capstone submission "${capstone.title}" has been rejected.${comment ? ' Please check the feedback.' : ''}`,
      `/capstone`,
      capstone._id as Types.ObjectId,
      this.buildRejectionEmail(capstone.studentName, capstone.title, comment),
    ).catch(() => {});

    return { success: true, message: 'Capstone rejected', data: capstone };
  }

  async addComment(id: string, comment: string) {
    if (!comment?.trim()) throw new BadRequestException('Comment cannot be empty');

    const capstone = await this.findCapstone(id);
    this.pushComment(capstone, 'instructor', comment);
    capstone.instructorComment = comment;

    await capstone.save();
    return { success: true, message: 'Comment added', data: capstone };
  }

  async gradeCapstone(
    id: string,
    payload: { grade: number; feedback: string; passed: boolean },
  ) {
    const capstone = await this.findCapstone(id);

    if (!['implementation_submitted', 'grading'].includes(capstone.status)) {
      throw new BadRequestException(
        'Implementation must be submitted before grading',
      );
    }

    const grade = Number(payload.grade);
    if (isNaN(grade) || grade < 0 || grade > 100) {
      throw new BadRequestException('Grade must be a number between 0 and 100');
    }

    capstone.grade = grade;
    capstone.gradeFeedback = payload.feedback || '';
    capstone.passed =
      payload.passed !== undefined ? payload.passed : grade >= 50;
    capstone.status = 'graded';
    capstone.gradedAt = new Date();

    if (payload.feedback) {
      this.pushComment(capstone, 'instructor', `Grade: ${grade}/100  ${payload.feedback}`);
    }

    await capstone.save();

    // Notify student (fire-and-forget)
    const passed = capstone.passed;
    this.notifyStudent(
      capstone.studentId.toString(),
      capstone.studentEmail,
      capstone.studentName,
      NotificationType.CAPSTONE_STATUS_UPDATED,
      'Capstone Graded',
      `Your capstone "${capstone.title}" has been graded: ${grade}/100  ${passed ? 'Passed' : 'Did not pass'}.`,
      `/capstone`,
      capstone._id as Types.ObjectId,
      this.buildGradingEmail(capstone.studentName, capstone.title, grade, passed, payload.feedback),
    ).catch(() => {});

    return { success: true, message: 'Capstone graded successfully', data: capstone };
  }

  async forceDeleteCapstone(id: string) {
    const capstone = await this.findCapstone(id);
    await this.capstoneModel.findByIdAndDelete(id);
    return { success: true, message: `Capstone submission by ${capstone.studentName} deleted` };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async findCapstone(id: string): Promise<CapstoneDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Capstone not found');
    const capstone = await this.capstoneModel.findById(id);
    if (!capstone) throw new NotFoundException('Capstone not found');
    return capstone;
  }

  private async findOwnedCapstone(
    id: string,
    studentId: string,
  ): Promise<CapstoneDocument> {
    const capstone = await this.findCapstone(id);
    if (capstone.studentId.toString() !== studentId) {
      throw new ForbiddenException('You do not have access to this capstone');
    }
    return capstone;
  }

  private pushComment(
    capstone: CapstoneDocument,
    from: string,
    message: string,
  ) {
    (capstone.comments as any[]).push({ from, message, createdAt: new Date() });
  }

  private async uploadFiles(
    files: Express.Multer.File[],
  ): Promise<{ fileName: string; fileUrl: string }[]> {
    const results: { fileName: string; fileUrl: string }[] = [];
    for (const file of files) {
      const uniqueName = `capstone-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${file.originalname}`;
      const fileUrl = await this.cloudinaryService.uploadDocument(
        file.buffer,
        uniqueName,
      );
      results.push({ fileName: file.originalname, fileUrl });
    }
    return results;
  }

  private async notifyStaff(
    type: NotificationType,
    title: string,
    message: string,
    link: string,
    relatedId: Types.ObjectId,
  ): Promise<void> {
    const staff = await this.userModel
      .find({ role: { $in: ['instructor', 'admin'] } })
      .select('_id email')
      .lean();

    await Promise.allSettled(
      staff.map((u: any) =>
        this.notificationsService.createNotification(
          u._id.toString(),
          type,
          title,
          message,
          link,
          relatedId.toString(),
        ),
      ),
    );
  }

  private async notifyStudent(
    studentId: string,
    studentEmail: string,
    studentName: string,
    type: NotificationType,
    title: string,
    message: string,
    link: string,
    relatedId: Types.ObjectId,
    emailHtml: string,
  ): Promise<void> {
    await Promise.allSettled([
      this.notificationsService.createNotification(
        studentId,
        type,
        title,
        message,
        link,
        relatedId.toString(),
      ),
      this.emailService
        .sendSimpleEmail(studentEmail, title, emailHtml)
        .catch(() => {}),
    ]);
  }

  // ── Email templates ────────────────────────────────────────────────────────

  private buildApprovalEmail(name: string, title: string, comment: string): string {
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#16a34a">Capstone Proposal Approved</h2>
        <p>Hi ${name},</p>
        <p>Great news! Your capstone proposal <strong>"${title}"</strong> has been approved.</p>
        <p>You can now proceed to submit your final implementation.</p>
        ${comment ? `<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px;margin:16px 0"><strong>Instructor note:</strong><br>${comment}</div>` : ''}
        <p>Log in to your dashboard to continue.</p>
      </div>`;
  }

  private buildRevisionEmail(
    name: string,
    title: string,
    comment: string,
    revisionCount: number,
  ): string {
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#d97706">Capstone Revision Requested</h2>
        <p>Hi ${name},</p>
        <p>Your capstone proposal <strong>"${title}"</strong> requires some revisions before it can be approved.</p>
        <div style="background:#fffbeb;border-left:4px solid #d97706;padding:12px;margin:16px 0">
          <strong>Instructor feedback:</strong><br>${comment}
        </div>
        <p>You have used <strong>${revisionCount}</strong> of 2 allowed revision attempts. Please update your proposal and resubmit.</p>
        <p>Log in to your dashboard to make the necessary changes.</p>
      </div>`;
  }

  private buildRejectionEmail(name: string, title: string, comment: string): string {
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#dc2626">Capstone Submission Rejected</h2>
        <p>Hi ${name},</p>
        <p>We regret to inform you that your capstone submission <strong>"${title}"</strong> has been rejected.</p>
        ${comment ? `<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px;margin:16px 0"><strong>Reason:</strong><br>${comment}</div>` : ''}
        <p>If you have questions, please reach out to your instructor.</p>
      </div>`;
  }

  private buildGradingEmail(
    name: string,
    title: string,
    grade: number,
    passed: boolean,
    feedback: string,
  ): string {
    const color = passed ? '#16a34a' : '#dc2626';
    const result = passed ? 'Passed' : 'Did not pass';
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:${color}">Capstone Graded</h2>
        <p>Hi ${name},</p>
        <p>Your capstone <strong>"${title}"</strong> has been graded.</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;font-size:18px">Score: <strong style="color:${color}">${grade}/100</strong></p>
          <p style="margin:8px 0 0;font-size:16px">Result: <strong style="color:${color}">${result}</strong></p>
        </div>
        ${feedback ? `<div style="background:#f9fafb;border-left:4px solid #6b7280;padding:12px;margin:16px 0"><strong>Feedback:</strong><br>${feedback}</div>` : ''}
        <p>Log in to your dashboard to view the full details.</p>
      </div>`;
  }
}
