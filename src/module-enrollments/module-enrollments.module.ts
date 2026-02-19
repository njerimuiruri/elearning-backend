import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModuleEnrollmentsController } from './module-enrollments.controller';
import { ModuleEnrollmentsService } from './module-enrollments.service';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';
import {
  ModuleCertificate,
  ModuleCertificateSchema,
} from '../schemas/module-certificate.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { ProgressionModule } from '../progression/progression.module';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
      { name: ModuleCertificate.name, schema: ModuleCertificateSchema },
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => ProgressionModule),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [ModuleEnrollmentsController],
  providers: [ModuleEnrollmentsService],
  exports: [ModuleEnrollmentsService],
})
export class ModuleEnrollmentsModule {}
