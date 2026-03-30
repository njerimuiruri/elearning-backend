import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BulkMessagingController } from './bulk-messaging.controller';
import { BulkMessagingService } from './bulk-messaging.service';
import {
  BulkReminder,
  BulkReminderSchema,
} from '../schemas/bulk-reminder.schema';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import {
  Module as LearningModule,
  ModuleSchema as LearningModuleSchema,
} from '../schemas/module.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BulkReminder.name, schema: BulkReminderSchema },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
      { name: LearningModule.name, schema: LearningModuleSchema },
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
    ]),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [BulkMessagingController],
  providers: [BulkMessagingService],
})
export class BulkMessagingModule {}
