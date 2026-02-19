import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProgressionController } from './progression.controller';
import { ProgressionService } from './progression.service';
import { LevelAccessGuard } from './guards/level-access.guard';
import {
  StudentProgression,
  StudentProgressionSchema,
} from '../schemas/student-progression.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import { ModulesModule } from '../modules/modules.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StudentProgression.name, schema: StudentProgressionSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
    ]),
    ModulesModule,
  ],
  controllers: [ProgressionController],
  providers: [ProgressionService, LevelAccessGuard],
  exports: [ProgressionService, LevelAccessGuard],
})
export class ProgressionModule {}
