import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscussionsController } from './discussions.controller';
import { DiscussionsService } from './discussions.service';
import { Discussion, DiscussionSchema } from '../schemas/discussion.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Discussion.name, schema: DiscussionSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [DiscussionsController],
  providers: [DiscussionsService],
  exports: [DiscussionsService],
})
export class DiscussionsModule {}
