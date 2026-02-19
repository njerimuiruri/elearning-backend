import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CourseFormatController } from './course-format.controller';
import { CourseFormat, CourseFormatSchema } from '../schemas/course-format.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: CourseFormat.name, schema: CourseFormatSchema }])],
  controllers: [CourseFormatController],
})
export class CourseFormatModule {}
