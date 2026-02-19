import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';
import { Module as ModuleSchema, ModuleSchema as ModuleSchemaDefinition } from '../schemas/module.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { ModuleEnrollment, ModuleEnrollmentSchema } from '../schemas/module-enrollment.schema';
import { ActivityLog, ActivityLogSchema } from '../schemas/activity-log.schema';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    CommonModule,
    MongooseModule.forFeature([
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
      { name: ActivityLog.name, schema: ActivityLogSchema },
    ]),
  ],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
