import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from '../schemas/user.schema';
import { PasswordReset, PasswordResetSchema } from '../schemas/password-reset.schema';
import { Course, CourseSchema } from '../schemas/course.schema';
import { CourseFormat, CourseFormatSchema } from '../schemas/course-format.schema';
import { Enrollment, EnrollmentSchema } from '../schemas/enrollment.schema';
import { EmailReminder, EmailReminderSchema } from '../schemas/email-reminder.schema';
import { ActivityLog, ActivityLogSchema } from '../schemas/activity-log.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import { EmailService } from '../common/services/email.service';
import { ReminderService } from '../services/reminder.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseFormat.name, schema: CourseFormatSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: EmailReminder.name, schema: EmailReminderSchema },
      { name: ActivityLog.name, schema: ActivityLogSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, EmailService, ReminderService],
  exports: [AdminService, ReminderService],
})
export class AdminModule {}