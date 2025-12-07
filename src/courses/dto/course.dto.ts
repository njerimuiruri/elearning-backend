import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsEnum } from 'class-validator';
import { CourseLevel } from '../../schemas/course.schema';

class QuestionDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsEnum(['multiple-choice', 'essay', 'true-false'])
  type: string;

  @IsNumber()
  points: number;

  @IsArray()
  @IsOptional()
  options?: string[];

  @IsString()
  @IsOptional()
  correctAnswer?: string;

  @IsString()
  @IsOptional()
  explanation?: string;
}

class ModuleDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsNumber()
  duration: number;

  @IsArray()
  @IsOptional()
  questions?: QuestionDto[];
}

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsEnum(CourseLevel)
  @IsOptional()
  level?: CourseLevel;

  @IsArray()
  @IsOptional()
  modules?: ModuleDto[];

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsOptional()
  courseTemplate?: string;
}

export class UpdateCourseDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsEnum(CourseLevel)
  @IsOptional()
  level?: CourseLevel;

  @IsArray()
  @IsOptional()
  modules?: ModuleDto[];

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;
}

export class SubmitCourseDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;
}

export class ApproveCourseDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsOptional()
  feedback?: string;
}

export class RejectCourseDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
