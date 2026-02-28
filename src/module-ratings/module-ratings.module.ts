import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModuleRatingsController } from './module-ratings.controller';
import { ModuleRatingsService } from './module-ratings.service';
import {
  ModuleRating,
  ModuleRatingSchema,
} from '../schemas/module-rating.schema';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModuleRating.name, schema: ModuleRatingSchema },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
    ]),
  ],
  controllers: [ModuleRatingsController],
  providers: [ModuleRatingsService],
  exports: [ModuleRatingsService],
})
export class ModuleRatingsModule {}
