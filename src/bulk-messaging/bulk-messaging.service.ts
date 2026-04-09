import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BulkReminder,
  BulkReminderFilterType,
} from '../schemas/bulk-reminder.schema';
import {
  BulkEmail,
  BulkEmailFilterType,
  BulkEmailRecipientStatus,
  BulkEmailStatus,
} from '../schemas/bulk-email.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { Module as LearningModule } from '../schemas/module.schema';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../schemas/notification.schema';
import {
  SendInstructorReminderDto,
  SendAdminReminderDto,
  SendBulkEmailDto,
  PreviewRecipientsDto,
} from './dto/bulk-message.dto';

// How many emails to send in each batch before pausing
const BATCH_SIZE = 50;
// Delay in ms between batches to avoid SMTP rate limits
const BATCH_DELAY_MS = 500;

@Injectable()
export class BulkMessagingService {
  constructor(
    @InjectModel(BulkReminder.name)
    private bulkReminderModel: Model<BulkReminder>,
    @InjectModel(BulkEmail.name)
    private bulkEmailModel: Model<BulkEmail>,
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(LearningModule.name)
    private moduleModel: Model<LearningModule>,
    @InjectModel(Category.name)
    private categoryModel: Model<Category>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // INSTRUCTOR METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get enrolled students for a module with optional status filter.
   * Only accessible by instructors assigned to the module.
   */
  async getEnrolledStudentsWithStatus(
    instructorId: string,
    moduleId: string,
    filter?: string,
    inactiveDays?: number,
  ) {
    const module = await this.moduleModel.findById(moduleId).lean();
    if (!module) throw new NotFoundException('Module not found');

    this.assertInstructorAssigned(module, instructorId);

    const query: any = { moduleId: new Types.ObjectId(moduleId) };
    this.applyEnrollmentFilter(query, filter, inactiveDays);

    const enrollments = await this.enrollmentModel
      .find(query)
      .populate('studentId', 'firstName lastName email profilePicture')
      .lean();

    return enrollments.map((e) => ({
      enrollmentId: e._id,
      student: e.studentId,
      progress: e.progress,
      completedLessons: e.completedLessons,
      totalLessons: e.totalLessons,
      finalAssessmentAttempts: e.finalAssessmentAttempts,
      finalAssessmentPassed: e.finalAssessmentPassed,
      pendingInstructorReview: e.pendingInstructorReview,
      requiresModuleRepeat: e.requiresModuleRepeat,
      isCompleted: e.isCompleted,
      lastAccessedAt: e.lastAccessedAt,
      enrolledAt: (e as any).createdAt,
    }));
  }

  /**
   * Send a bulk reminder from an instructor to filtered students in a module.
   */
  async sendInstructorBulkMessage(
    instructorId: string,
    dto: SendInstructorReminderDto,
  ) {
    const module = await this.moduleModel.findById(dto.moduleId).lean();
    if (!module) throw new NotFoundException('Module not found');
    this.assertInstructorAssigned(module, instructorId);

    const instructor = await this.userModel.findById(instructorId).lean();
    if (!instructor) throw new NotFoundException('Instructor not found');

    const category = module.categoryId
      ? await this.categoryModel.findById(module.categoryId).lean()
      : null;

    // Determine recipient list
    let enrollments: any[];
    if (dto.studentIds && dto.studentIds.length > 0) {
      enrollments = await this.enrollmentModel
        .find({
          moduleId: new Types.ObjectId(dto.moduleId),
          studentId: {
            $in: dto.studentIds.map((id) => new Types.ObjectId(id)),
          },
        })
        .populate('studentId', 'firstName lastName email')
        .lean();
    } else {
      const query: any = { moduleId: new Types.ObjectId(dto.moduleId) };
      this.applyEnrollmentFilter(query, dto.filterType, dto.inactiveDays);
      enrollments = await this.enrollmentModel
        .find(query)
        .populate('studentId', 'firstName lastName email')
        .lean();
    }

    if (enrollments.length === 0) {
      return {
        sent: 0,
        total: 0,
        message: 'No students matched the filter criteria.',
      };
    }

    const senderName = `${(instructor as any).firstName} ${(instructor as any).lastName}`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/dashboard`;

    let sent = 0;
    await Promise.allSettled(
      enrollments.map(async (enrollment) => {
        const student = enrollment.studentId;
        if (!student?.email) return;

        const studentName = `${student.firstName} ${student.lastName}`;
        const studentId = (student._id || student.id)?.toString();

        try {
          await this.emailService.sendBulkReminderToStudent({
            studentName,
            studentEmail: student.email,
            senderName,
            senderRole: 'instructor',
            moduleName: module.title,
            categoryName: (category as any)?.name,
            subject: dto.subject,
            message: dto.message,
            dashboardUrl,
          });
        } catch (err) {
          console.error(
            `Failed to send bulk reminder email to ${student.email}:`,
            err,
          );
        }

        try {
          await this.notificationsService.createReminderNotification(
            studentId,
            NotificationType.INSTRUCTOR_REMINDER,
            dto.subject,
            dto.message,
            dashboardUrl,
            dto.moduleId,
            module.categoryId?.toString(),
          );
        } catch (err) {
          console.error(
            `Failed to create notification for student ${studentId}:`,
            err,
          );
        }

        sent++;
      }),
    );

    await this.bulkReminderModel.create({
      senderId: new Types.ObjectId(instructorId),
      senderRole: 'instructor',
      senderName,
      moduleId: new Types.ObjectId(dto.moduleId),
      moduleName: module.title,
      categoryId: module.categoryId,
      categoryName: (category as any)?.name,
      subject: dto.subject,
      message: dto.message,
      filterType: dto.filterType || BulkReminderFilterType.ALL,
      inactiveDays: dto.inactiveDays,
      recipientCount: sent,
      recipientType: 'students',
    });

    return {
      sent,
      total: enrollments.length,
      message: `Reminder sent to ${sent} student(s).`,
    };
  }

  /** Get this instructor's sent reminder history. */
  async getInstructorReminderHistory(instructorId: string) {
    return this.bulkReminderModel
      .find({
        senderId: new Types.ObjectId(instructorId),
        senderRole: 'instructor',
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get all instructors with their pending/completed assessment grading status.
   */
  async getInstructorGradingStatus(moduleId?: string, categoryId?: string) {
    const moduleQuery: any = { isActive: true };
    if (moduleId) moduleQuery._id = new Types.ObjectId(moduleId);
    if (categoryId) moduleQuery.categoryId = new Types.ObjectId(categoryId);

    const modules = await this.moduleModel
      .find(moduleQuery)
      .select('_id title instructorIds categoryId')
      .lean();

    if (modules.length === 0) return [];

    const instructorIdSet = new Set<string>();
    for (const m of modules) {
      for (const id of (m as any).instructorIds || []) {
        instructorIdSet.add(id.toString());
      }
    }

    const instructors = await this.userModel
      .find({
        _id: {
          $in: Array.from(instructorIdSet).map((id) => new Types.ObjectId(id)),
        },
      })
      .select('_id firstName lastName email')
      .lean();

    const instructorMap = new Map(
      instructors.map((i) => [(i._id as any).toString(), i]),
    );

    const result = await Promise.all(
      Array.from(instructorIdSet).map(async (iId) => {
        const instructorModules = modules.filter((m) =>
          ((m as any).instructorIds || []).some(
            (id: any) => id.toString() === iId,
          ),
        );
        const moduleIds = instructorModules.map((m) => m._id);

        const [pendingCount, gradedCount] = await Promise.all([
          this.enrollmentModel.countDocuments({
            moduleId: { $in: moduleIds },
            pendingInstructorReview: true,
          }),
          this.enrollmentModel.countDocuments({
            moduleId: { $in: moduleIds },
            pendingInstructorReview: false,
            finalAssessmentAttempts: { $gt: 0 },
          }),
        ]);

        const user = instructorMap.get(iId) as any;
        return {
          instructorId: iId,
          name: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
          email: user?.email,
          pendingAssessments: pendingCount,
          gradedAssessments: gradedCount,
          modules: instructorModules.map((m) => ({
            moduleId: m._id,
            title: (m as any).title,
          })),
        };
      }),
    );

    return result.sort((a, b) => b.pendingAssessments - a.pendingAssessments);
  }

  /**
   * Get all students with optional filters (admin view).
   */
  async getAllStudentsWithFilters(
    moduleId?: string,
    categoryId?: string,
    filter?: string,
    inactiveDays?: number,
  ) {
    const query: any = {};

    if (moduleId) {
      query.moduleId = new Types.ObjectId(moduleId);
    } else if (categoryId) {
      const modules = await this.moduleModel
        .find({ categoryId: new Types.ObjectId(categoryId) })
        .select('_id')
        .lean();
      query.moduleId = { $in: modules.map((m) => m._id) };
    }

    this.applyEnrollmentFilter(query, filter, inactiveDays);

    const enrollments = await this.enrollmentModel
      .find(query)
      .populate('studentId', 'firstName lastName email profilePicture')
      .populate('moduleId', 'title categoryId level')
      .lean();

    return enrollments.map((e) => {
      const student = e.studentId as any;
      const mod = e.moduleId as any;
      return {
        enrollmentId: e._id,
        student: {
          id: student?._id,
          name: student
            ? `${student.firstName} ${student.lastName}`
            : 'Unknown',
          email: student?.email,
          profilePicture: student?.profilePicture,
        },
        module: {
          id: mod?._id,
          title: mod?.title,
          level: mod?.level,
          categoryId: mod?.categoryId,
        },
        progress: e.progress,
        completedLessons: e.completedLessons,
        totalLessons: e.totalLessons,
        finalAssessmentPassed: e.finalAssessmentPassed,
        pendingInstructorReview: e.pendingInstructorReview,
        isCompleted: e.isCompleted,
        lastAccessedAt: e.lastAccessedAt,
        enrolledAt: (e as any).createdAt,
      };
    });
  }

  /**
   * Send a bulk reminder from admin to students or instructors.
   */
  async sendAdminBulkMessage(adminId: string, dto: SendAdminReminderDto) {
    const admin = (await this.userModel.findById(adminId).lean()) as any;
    if (!admin) throw new NotFoundException('Admin not found');
    const adminName = `${admin.firstName} ${admin.lastName}`;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/dashboard`;

    let moduleName: string | undefined;
    let categoryName: string | undefined;

    if (dto.moduleId) {
      const mod = (await this.moduleModel.findById(dto.moduleId).lean()) as any;
      moduleName = mod?.title;
    }
    if (dto.categoryId) {
      const cat = (await this.categoryModel
        .findById(dto.categoryId)
        .lean()) as any;
      categoryName = cat?.name;
    }

    let sent = 0;

    if (dto.recipientType === 'students') {
      sent = await this.sendAdminMessageToStudents(
        dto,
        adminName,
        dashboardUrl,
        moduleName,
        categoryName,
      );
    } else {
      sent = await this.sendAdminMessageToInstructors(
        dto,
        adminName,
        dashboardUrl,
        moduleName,
        categoryName,
      );
    }

    await this.bulkReminderModel.create({
      senderId: new Types.ObjectId(adminId),
      senderRole: 'admin',
      senderName: adminName,
      moduleId: dto.moduleId ? new Types.ObjectId(dto.moduleId) : undefined,
      moduleName,
      categoryId: dto.categoryId
        ? new Types.ObjectId(dto.categoryId)
        : undefined,
      categoryName,
      subject: dto.subject,
      message: dto.message,
      filterType: dto.filterType || BulkReminderFilterType.ALL,
      inactiveDays: dto.inactiveDays,
      recipientCount: sent,
      recipientType: dto.recipientType,
    });

    return {
      sent,
      message: `Reminder sent to ${sent} ${dto.recipientType}.`,
    };
  }

  /** Get all sent reminders (admin view). */
  async getAllReminderHistory(limit = 50) {
    return this.bulkReminderModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private assertInstructorAssigned(module: any, instructorId: string) {
    const isAssigned = (module.instructorIds || []).some(
      (id: any) => id.toString() === instructorId,
    );
    if (!isAssigned) {
      throw new ForbiddenException('You are not assigned to this module.');
    }
  }

  private applyEnrollmentFilter(
    query: any,
    filter?: string,
    inactiveDays?: number,
  ) {
    switch (filter) {
      case BulkReminderFilterType.ASSESSMENT_PENDING:
        query.finalAssessmentAttempts = 0;
        query.isCompleted = false;
        query.pendingInstructorReview = false;
        break;
      case BulkReminderFilterType.ASSESSMENT_SUBMITTED:
        query.pendingInstructorReview = true;
        break;
      case BulkReminderFilterType.ASSESSMENT_PASSED:
        query.finalAssessmentPassed = true;
        break;
      case BulkReminderFilterType.ASSESSMENT_FAILED:
        query.finalAssessmentAttempts = { $gt: 0 };
        query.finalAssessmentPassed = false;
        query.pendingInstructorReview = false;
        break;
      case BulkReminderFilterType.INACTIVE: {
        const days = inactiveDays || 7;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        query.isCompleted = false;
        query.$or = [
          { lastAccessedAt: { $lt: cutoff } },
          { lastAccessedAt: null },
        ];
        break;
      }
      // 'all' — no extra filter applied
    }
  }

  private async sendAdminMessageToStudents(
    dto: SendAdminReminderDto,
    adminName: string,
    dashboardUrl: string,
    moduleName?: string,
    categoryName?: string,
  ): Promise<number> {
    let enrollments: any[];

    if (dto.specificIds && dto.specificIds.length > 0) {
      const students = await this.userModel
        .find({
          _id: { $in: dto.specificIds.map((id) => new Types.ObjectId(id)) },
        })
        .select('_id firstName lastName email')
        .lean();
      // Wrap students to match enrollment shape
      enrollments = students.map((s) => ({ studentId: s }));
    } else {
      const query: any = {};
      if (dto.moduleId) {
        query.moduleId = new Types.ObjectId(dto.moduleId);
      } else if (dto.categoryId) {
        const modules = await this.moduleModel
          .find({ categoryId: new Types.ObjectId(dto.categoryId) })
          .select('_id')
          .lean();
        query.moduleId = { $in: modules.map((m) => m._id) };
      }
      this.applyEnrollmentFilter(query, dto.filterType, dto.inactiveDays);
      enrollments = await this.enrollmentModel
        .find(query)
        .populate('studentId', 'firstName lastName email')
        .lean();
    }

    if (enrollments.length === 0) return 0;

    let sent = 0;
    await Promise.allSettled(
      enrollments.map(async (enrollment) => {
        const student = enrollment.studentId;
        if (!student?.email) return;

        const studentName = `${student.firstName} ${student.lastName}`;
        const studentId = (student._id || student.id)?.toString();

        try {
          await this.emailService.sendBulkReminderToStudent({
            studentName,
            studentEmail: student.email,
            senderName: adminName,
            senderRole: 'admin',
            moduleName,
            categoryName,
            subject: dto.subject,
            message: dto.message,
            dashboardUrl,
          });
        } catch (err) {
          console.error(
            `Failed to send admin reminder email to ${student.email}:`,
            err,
          );
        }

        try {
          await this.notificationsService.createReminderNotification(
            studentId,
            NotificationType.ADMIN_REMINDER,
            dto.subject,
            dto.message,
            dashboardUrl,
            dto.moduleId,
            dto.categoryId,
          );
        } catch (err) {
          console.error(
            `Failed to create admin notification for student ${studentId}:`,
            err,
          );
        }

        sent++;
      }),
    );

    return sent;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN BULK EMAIL (composed emails with CC/BCC/attachments)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Resolve which users should receive the email based on the filter.
   */
  async previewBulkEmailRecipients(dto: PreviewRecipientsDto) {
    const users = await this.resolveBulkEmailRecipients(dto);
    return users.map((u) => ({
      id: (u._id as any).toString(),
      name: `${(u as any).firstName} ${(u as any).lastName}`,
      email: (u as any).email,
      cohort: (u as any).fellowData?.cohort,
    }));
  }

  /**
   * Compose and send a bulk email campaign.
   * Persists the campaign record then sends in background batches.
   */
  async sendBulkEmail(adminId: string, dto: SendBulkEmailDto) {
    const admin = (await this.userModel.findById(adminId).lean()) as any;
    if (!admin) throw new NotFoundException('Admin not found');
    const adminName = `${admin.firstName} ${admin.lastName}`;

    const users = await this.resolveBulkEmailRecipients({
      filterType: dto.filterType,
      filterCategoryIds: dto.filterCategoryIds,
      filterCohorts: dto.filterCohorts,
      manualUserIds: dto.manualUserIds,
    });

    if (users.length === 0) {
      return { success: true, sent: 0, total: 0, message: 'No recipients matched the filter.' };
    }

    // Build per-recipient tracking entries
    const recipientEntries = users.map((u) => ({
      userId: u._id,
      email: (u as any).email,
      name: `${(u as any).firstName} ${(u as any).lastName}`,
      status: BulkEmailRecipientStatus.PENDING,
      sentAt: null,
      error: null,
    }));

    // Persist campaign record (status: sending)
    const campaign = await this.bulkEmailModel.create({
      senderId: new Types.ObjectId(adminId),
      senderName: adminName,
      subject: dto.subject,
      body: dto.body,
      filterType: dto.filterType,
      filterCategoryIds: (dto.filterCategoryIds || []).map(
        (id) => new Types.ObjectId(id),
      ),
      filterCohorts: dto.filterCohorts || [],
      recipients: recipientEntries,
      cc: dto.cc || [],
      bcc: dto.bcc || [],
      attachments: dto.attachments || [],
      status: BulkEmailStatus.SENDING,
      totalRecipients: users.length,
      sentCount: 0,
      failedCount: 0,
    });

    // Fire-and-forget: send in background batches, update DB as we go
    this.dispatchBulkEmailBatches(campaign._id.toString(), dto, adminName).catch(
      (err) => console.error('Bulk email dispatch error:', err),
    );

    return {
      success: true,
      campaignId: campaign._id.toString(),
      total: users.length,
      message: `Bulk email campaign started for ${users.length} recipient(s).`,
    };
  }

  /** Get paginated list of bulk email campaigns (newest first). */
  async getBulkEmailCampaigns(limit = 20, offset = 0) {
    const [data, total] = await Promise.all([
      this.bulkEmailModel
        .find()
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .select('-recipients') // exclude large array from list view
        .lean(),
      this.bulkEmailModel.countDocuments(),
    ]);
    return { data, total };
  }

  /** Get a single campaign with full per-recipient delivery status. */
  async getBulkEmailCampaign(campaignId: string) {
    const campaign = await this.bulkEmailModel.findById(campaignId).lean();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve users based on the filter type.
   */
  private async resolveBulkEmailRecipients(dto: PreviewRecipientsDto) {
    const query: any = { isActive: true };

    switch (dto.filterType) {
      case BulkEmailFilterType.ALL_FELLOWS:
        query['fellowData.fellowshipStatus'] = { $exists: true };
        break;

      case BulkEmailFilterType.BY_CATEGORY:
        if (!dto.filterCategoryIds || dto.filterCategoryIds.length === 0) {
          return [];
        }
        query['fellowData.assignedCategories'] = {
          $in: dto.filterCategoryIds.map((id) => new Types.ObjectId(id)),
        };
        break;

      case BulkEmailFilterType.BY_COHORT:
        if (!dto.filterCohorts || dto.filterCohorts.length === 0) {
          return [];
        }
        query['fellowData.cohort'] = { $in: dto.filterCohorts };
        break;

      case BulkEmailFilterType.ALL_STUDENTS:
        query.role = 'student';
        break;

      case BulkEmailFilterType.ALL_INSTRUCTORS:
        query.role = 'instructor';
        break;

      case BulkEmailFilterType.MANUAL:
        if (!dto.manualUserIds || dto.manualUserIds.length === 0) return [];
        return this.userModel
          .find({
            _id: { $in: dto.manualUserIds.map((id) => new Types.ObjectId(id)) },
            isActive: true,
          })
          .select('_id firstName lastName email fellowData')
          .lean();

      default:
        return [];
    }

    return this.userModel
      .find(query)
      .select('_id firstName lastName email fellowData')
      .lean();
  }

  /**
   * Background batch dispatcher. Updates the campaign DB record after each batch.
   */
  private async dispatchBulkEmailBatches(
    campaignId: string,
    dto: SendBulkEmailDto,
    adminName: string,
  ) {
    const campaign = await this.bulkEmailModel.findById(campaignId);
    if (!campaign) return;

    const attachments = (dto.attachments || []).map((a) => ({
      filename: a.filename,
      path: a.url,
      contentType: a.mimeType,
    }));

    let sentCount = 0;
    let failedCount = 0;

    // Process recipients in batches
    for (let i = 0; i < campaign.recipients.length; i += BATCH_SIZE) {
      const batch = campaign.recipients.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (recipient) => {
          const result = await this.emailService.sendComposedEmail({
            to: recipient.email,
            toName: recipient.name,
            subject: dto.subject,
            htmlBody: dto.body,
            cc: dto.cc,
            bcc: dto.bcc,
            attachments,
            fromName: `${adminName} via ARIN eLearning`,
          });

          // Update per-recipient status inline
          const rec = campaign.recipients.find(
            (r) => r.email === recipient.email,
          );
          if (rec) {
            if (result.success) {
              rec.status = BulkEmailRecipientStatus.SENT;
              rec.sentAt = new Date();
              sentCount++;
            } else {
              rec.status = BulkEmailRecipientStatus.FAILED;
              rec.error = result.message;
              failedCount++;
            }
          }
        }),
      );

      // Persist progress after each batch
      campaign.sentCount = sentCount;
      campaign.failedCount = failedCount;
      await campaign.save();

      // Throttle between batches (skip delay after last batch)
      if (i + BATCH_SIZE < campaign.recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Final status
    const finalStatus =
      failedCount === 0
        ? BulkEmailStatus.SENT
        : sentCount === 0
          ? BulkEmailStatus.FAILED
          : BulkEmailStatus.PARTIAL;

    campaign.status = finalStatus;
    campaign.completedAt = new Date();
    await campaign.save();
  }

  private async sendAdminMessageToInstructors(
    dto: SendAdminReminderDto,
    adminName: string,
    dashboardUrl: string,
    moduleName?: string,
    categoryName?: string,
  ): Promise<number> {
    let instructors: any[];

    if (dto.specificIds && dto.specificIds.length > 0) {
      instructors = await this.userModel
        .find({
          _id: { $in: dto.specificIds.map((id) => new Types.ObjectId(id)) },
        })
        .select('_id firstName lastName email')
        .lean();
    } else {
      const moduleQuery: any = { isActive: true };
      if (dto.moduleId) moduleQuery._id = new Types.ObjectId(dto.moduleId);
      else if (dto.categoryId)
        moduleQuery.categoryId = new Types.ObjectId(dto.categoryId);

      const modules = await this.moduleModel
        .find(moduleQuery)
        .select('instructorIds')
        .lean();

      const instructorIdSet = new Set<string>();
      for (const m of modules) {
        for (const id of (m as any).instructorIds || []) {
          instructorIdSet.add(id.toString());
        }
      }

      if (instructorIdSet.size === 0) return 0;

      instructors = await this.userModel
        .find({
          _id: {
            $in: Array.from(instructorIdSet).map(
              (id) => new Types.ObjectId(id),
            ),
          },
        })
        .select('_id firstName lastName email')
        .lean();
    }

    if (instructors.length === 0) return 0;

    let sent = 0;
    await Promise.allSettled(
      instructors.map(async (instructor: any) => {
        if (!instructor.email) return;

        const instructorName = `${instructor.firstName} ${instructor.lastName}`;
        const instructorId = (instructor._id || instructor.id)?.toString();

        try {
          await this.emailService.sendBulkReminderToInstructor({
            instructorName,
            instructorEmail: instructor.email,
            adminName,
            subject: dto.subject,
            message: dto.message,
            moduleName,
            categoryName,
            dashboardUrl,
          });
        } catch (err) {
          console.error(
            `Failed to send admin reminder email to instructor ${instructor.email}:`,
            err,
          );
        }

        try {
          await this.notificationsService.createReminderNotification(
            instructorId,
            NotificationType.ADMIN_REMINDER,
            dto.subject,
            dto.message,
            dashboardUrl,
            dto.moduleId,
            dto.categoryId,
          );
        } catch (err) {
          console.error(
            `Failed to create notification for instructor ${instructorId}:`,
            err,
          );
        }

        sent++;
      }),
    );

    return sent;
  }
}
