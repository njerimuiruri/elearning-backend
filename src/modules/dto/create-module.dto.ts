import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ModuleLevel } from '../../schemas/module.schema';

export class LessonResourceDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  fileType?: string;
}

export class QuestionDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsString()
  @IsEnum(['multiple-choice', 'essay', 'true-false'])
  type: string;

  @IsNumber()
  points: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  rubric?: string;
}

export class LessonAssessmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];

  @IsOptional()
  @IsNumber()
  passingScore?: number;

  @IsOptional()
  @IsNumber()
  maxAttempts?: number;
}

export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LessonResourceDto)
  resources?: LessonResourceDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LessonAssessmentDto)
  assessment?: LessonAssessmentDto;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class FinalAssessmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];

  @IsOptional()
  @IsNumber()
  passingScore?: number;

  @IsOptional()
  @IsNumber()
  maxAttempts?: number;

  @IsOptional()
  @IsNumber()
  timeLimit?: number;
}

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsEnum(ModuleLevel)
  @IsNotEmpty()
  level: ModuleLevel;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLessonDto)
  lessons?: CreateLessonDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FinalAssessmentDto)
  finalAssessment?: FinalAssessmentDto;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prerequisites?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  learningOutcomes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetAudience?: string[];

  @IsOptional()
  @IsString()
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  deliveryMode?: string;

  @IsOptional()
  @IsString()
  moduleAim?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  moduleObjectives?: string[];
}
