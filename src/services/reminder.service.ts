import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Enrollment } from '../schemas/enrollment.schema';
import { User } from '../schemas/user.schema';
import { Course } from '../schemas/course.schema';
import { EmailReminder } from '../schemas/email-reminder.schema';
import {
  Module as ModuleSchema,
} from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../schemas/notification.schema';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private autoRemindersEnabled = true;
  private reminderDelayDays = 7; // Course enrollments: 7 days
  private moduleReminderDelayDays = 4; // Module enrollments: 4 days
  private lastAutomaticRunAt: Date | null = null;

  constructor(
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(EmailReminder.name) private emailReminderModel: Model<EmailReminder>,
    @InjectModel(ModuleSchema.name) private moduleModel: Model<ModuleSchema>,
    @InjectModel(ModuleEnrollment.name) private moduleEnrollmentModel: Model<ModuleEnrollment>,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Scheduled job that runs daily at 9 AM to check for inactive students
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleAutomaticReminders() {
    if (!this.autoRemindersEnabled) {
      this.logger.log('Automatic reminders are disabled. Skipping...');
      return;
    }

    this.logger.log('Starting automatic reminder check...');

    try {
      // Course enrollments (7-day threshold)
      const inactiveEnrollments = await this.findInactiveEnrollments();
      this.logger.log(`Found ${inactiveEnrollments.length} inactive course enrollments`);

      for (const enrollment of inactiveEnrollments) {
        await this.sendCourseReminder(enrollment._id.toString(), 'automatic');
      }

      // Module enrollments (4-day threshold)
      const inactiveModuleEnrollments = await this.findInactiveModuleEnrollments();
      this.logger.log(`Found ${inactiveModuleEnrollments.length} inactive module enrollments`);

      for (const enrollment of inactiveModuleEnrollments) {
        await this.sendModuleReminder(enrollment._id.toString(), 'automatic');
      }

      this.lastAutomaticRunAt = new Date();
      this.logger.log('Automatic reminder check completed');
    } catch (error) {
      this.logger.error('Error in automatic reminder check:', error);
    }
  }

  /**
   * Find course enrollments inactive for more than reminderDelayDays
   */
  async findInactiveEnrollments(): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.reminderDelayDays);

    const enrollments = await this.enrollmentModel.find({
      isCompleted: false,
      $or: [
        { lastAccessedAt: { $lte: cutoffDate } },
        { lastAccessedAt: null, createdAt: { $lte: cutoffDate } },
      ],
    })
      .populate('studentId', 'firstName lastName email')
      .populate('courseId', 'title')
      .lean();

    const filtered: any[] = [];
    for (const enrollment of enrollments) {
      const recentReminder = await this.emailReminderModel.findOne({
        enrollmentId: enrollment._id,
        reminderType: 'incomplete',
        sentAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      });

      if (!recentReminder) {
        filtered.push(enrollment);
      }
    }

    return filtered;
  }

  /**
   * Find module enrollments inactive for more than moduleReminderDelayDays (default 4)
   */
  async findInactiveModuleEnrollments(): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.moduleReminderDelayDays);

    const enrollments = await this.moduleEnrollmentModel.find({
      isCompleted: false,
      $or: [
        { lastAccessedAt: { $lte: cutoffDate } },
        { lastAccessedAt: null, createdAt: { $lte: cutoffDate } },
      ],
    })
      .populate('studentId', 'firstName lastName email')
      .populate('moduleId', 'title')
      .lean();

    const filtered: any[] = [];
    for (const enrollment of enrollments) {
      const recentReminder = await this.emailReminderModel.findOne({
        enrollmentId: enrollment._id,
        reminderType: 'module_incomplete',
        sentAt: { $gte: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
      });

      if (!recentReminder) {
        filtered.push(enrollment);
      }
    }

    return filtered;
  }

  /**
   * Send reminder email for a specific course enrollment
   */
  async sendCourseReminder(enrollmentId: string, triggerType: 'manual' | 'automatic' = 'manual') {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId)
        .populate('studentId', 'firstName lastName email')
        .populate('courseId', 'title description');

      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      const student = enrollment.studentId as any;
      const course = enrollment.courseId as any;

      if (!student || !course) {
        throw new Error('Student or course data missing');
      }

      await this.emailService.sendCourseCompletionReminder(
        student.email,
        student.firstName,
        course.title,
        enrollment.progress,
        course._id.toString(),
      );

      await this.emailReminderModel.create({
        studentId: student._id,
        courseId: course._id,
        enrollmentId: enrollment._id,
        reminderType: 'incomplete',
        sent: true,
        sentAt: new Date(),
      });

      // Dashboard notification
      await this.notificationsService.createNotification(
        student._id.toString(),
        NotificationType.INACTIVITY_REMINDER,
        'Continue Your Learning',
        `You haven't visited "${course.title}" in a while. You're ${Math.round(enrollment.progress)}% through — keep going!`,
      ).catch(() => {});

      this.logger.log(
        `Course reminder sent (${triggerType}) to ${student.email} for course ${course.title}`,
      );

      return {
        success: true,
        message: `Reminder sent to ${student.firstName} ${student.lastName}`,
      };
    } catch (error) {
      this.logger.error(`Error sending course reminder for enrollment ${enrollmentId}:`, error);
      throw error;
    }
  }

  /**
   * Send reminder email for a specific module enrollment
   */
  async sendModuleReminder(enrollmentId: string, triggerType: 'manual' | 'automatic' = 'manual') {
    try {
      const enrollment = await this.moduleEnrollmentModel.findById(enrollmentId)
        .populate('studentId', 'firstName lastName email')
        .populate('moduleId', 'title');

      if (!enrollment) {
        throw new Error('Module enrollment not found');
      }

      const student = enrollment.studentId as any;
      const module = enrollment.moduleId as any;

      if (!student || !module) {
        throw new Error('Student or module data missing');
      }

      await this.emailService.sendModuleInactivityReminder(
        student.email,
        `${student.firstName} ${student.lastName}`.trim(),
        module.title,
        enrollment.progress,
        module._id.toString(),
      );

      await this.emailReminderModel.create({
        studentId: student._id,
        enrollmentId: enrollment._id,
        reminderType: 'module_incomplete',
        sent: true,
        sentAt: new Date(),
      });

      // Dashboard notification
      await this.notificationsService.createNotification(
        student._id.toString(),
        NotificationType.INACTIVITY_REMINDER,
        'Continue Your Learning',
        `You haven't visited "${module.title}" in a while. You're ${Math.round(enrollment.progress)}% through — keep going!`,
      ).catch(() => {});

      this.logger.log(
        `Module reminder sent (${triggerType}) to ${student.email} for module ${module.title}`,
      );

      return {
        success: true,
        message: `Module reminder sent to ${student.firstName} ${student.lastName}`,
      };
    } catch (error) {
      this.logger.error(`Error sending module reminder for enrollment ${enrollmentId}:`, error);
      throw error;
    }
  }

  /**
   * Get students who need reminders (for admin dashboard)
   */
  async getStudentsNeedingReminders(limit = 50) {
    const inactiveEnrollments = await this.findInactiveEnrollments();

    const studentsData = await Promise.all(
      inactiveEnrollments.slice(0, limit).map(async (enrollment: any) => {
        const student = enrollment.studentId as any;
        const course = enrollment.courseId as any;

        const lastReminder = await this.emailReminderModel.findOne({
          enrollmentId: enrollment._id,
          reminderType: 'incomplete',
        }).sort({ sentAt: -1 });

        return {
          type: 'course',
          enrollmentId: enrollment._id,
          student: {
            id: student._id,
            name: `${student.firstName} ${student.lastName}`,
            email: student.email,
          },
          course: {
            id: course._id,
            title: course.title,
          },
          progress: enrollment.progress,
          lastAccessedAt: enrollment.lastAccessedAt || enrollment.createdAt,
          daysSinceLastAccess: Math.floor(
            (Date.now() - (enrollment.lastAccessedAt || enrollment.createdAt).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
          lastReminderSent: lastReminder?.sentAt || null,
          reminderCount: await this.emailReminderModel.countDocuments({
            enrollmentId: enrollment._id,
            reminderType: 'incomplete',
          }),
        };
      }),
    );

    // Also include module enrollments
    const inactiveModuleEnrollments = await this.findInactiveModuleEnrollments();

    const moduleStudentsData = await Promise.all(
      inactiveModuleEnrollments.slice(0, limit).map(async (enrollment: any) => {
        const student = enrollment.studentId as any;
        const module = enrollment.moduleId as any;

        const lastReminder = await this.emailReminderModel.findOne({
          enrollmentId: enrollment._id,
          reminderType: 'module_incomplete',
        }).sort({ sentAt: -1 });

        return {
          type: 'module',
          enrollmentId: enrollment._id,
          student: {
            id: student._id,
            name: `${student.firstName} ${student.lastName}`,
            email: student.email,
          },
          module: {
            id: module._id,
            title: module.title,
          },
          progress: enrollment.progress,
          lastAccessedAt: enrollment.lastAccessedAt || enrollment.createdAt,
          daysSinceLastAccess: Math.floor(
            (Date.now() - (enrollment.lastAccessedAt || enrollment.createdAt).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
          lastReminderSent: lastReminder?.sentAt || null,
          reminderCount: await this.emailReminderModel.countDocuments({
            enrollmentId: enrollment._id,
            reminderType: 'module_incomplete',
          }),
        };
      }),
    );

    return [...studentsData, ...moduleStudentsData];
  }

  /**
   * Send bulk reminders to multiple enrollments
   */
  async sendBulkReminders(enrollmentIds: string[]) {
    const results: {
      successful: string[];
      failed: Array<{ enrollmentId: string; error: any }>;
    } = {
      successful: [],
      failed: [],
    };

    for (const enrollmentId of enrollmentIds) {
      try {
        await this.sendCourseReminder(enrollmentId, 'manual');
        results.successful.push(enrollmentId);
      } catch (error) {
        results.failed.push({ enrollmentId, error: error.message });
      }
    }

    return results;
  }

  /**
   * Send bulk module reminders
   */
  async sendBulkModuleReminders(enrollmentIds: string[]) {
    const results: {
      successful: string[];
      failed: Array<{ enrollmentId: string; error: any }>;
    } = {
      successful: [],
      failed: [],
    };

    for (const enrollmentId of enrollmentIds) {
      try {
        await this.sendModuleReminder(enrollmentId, 'manual');
        results.successful.push(enrollmentId);
      } catch (error) {
        results.failed.push({ enrollmentId, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get reminder settings
   */
  getReminderSettings() {
    return {
      autoRemindersEnabled: this.autoRemindersEnabled,
      reminderDelayDays: this.reminderDelayDays,
      moduleReminderDelayDays: this.moduleReminderDelayDays,
    };
  }

  /**
   * Update reminder settings
   */
  updateReminderSettings(settings: {
    autoRemindersEnabled?: boolean;
    reminderDelayDays?: number;
    moduleReminderDelayDays?: number;
  }) {
    if (settings.autoRemindersEnabled !== undefined) {
      this.autoRemindersEnabled = settings.autoRemindersEnabled;
      this.logger.log(`Auto reminders ${this.autoRemindersEnabled ? 'enabled' : 'disabled'}`);
    }

    if (settings.reminderDelayDays !== undefined && settings.reminderDelayDays > 0) {
      this.reminderDelayDays = settings.reminderDelayDays;
      this.logger.log(`Course reminder delay set to ${this.reminderDelayDays} days`);
    }

    if (settings.moduleReminderDelayDays !== undefined && settings.moduleReminderDelayDays > 0) {
      this.moduleReminderDelayDays = settings.moduleReminderDelayDays;
      this.logger.log(`Module reminder delay set to ${this.moduleReminderDelayDays} days`);
    }

    return this.getReminderSettings();
  }

  /**
   * Get reminder statistics
   */
  async getReminderStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalRemindersSent,
      remindersLast30Days,
      activeEnrollments,
      activeModuleEnrollments,
      inactiveCount,
      inactiveModuleCount,
    ] = await Promise.all([
      this.emailReminderModel.countDocuments({ sent: true }),
      this.emailReminderModel.countDocuments({ sent: true, sentAt: { $gte: thirtyDaysAgo } }),
      this.enrollmentModel.countDocuments({ isCompleted: false }),
      this.moduleEnrollmentModel.countDocuments({ isCompleted: false }),
      this.findInactiveEnrollments().then(e => e.length),
      this.findInactiveModuleEnrollments().then(e => e.length),
    ]);

    return {
      totalRemindersSent,
      remindersLast30Days,
      activeEnrollments,
      activeModuleEnrollments,
      inactiveEnrollments: inactiveCount,
      inactiveModuleEnrollments: inactiveModuleCount,
      lastAutomaticRunAt: this.lastAutomaticRunAt,
      settings: this.getReminderSettings(),
    };
  }
}
