import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ModuleLevel } from '../../schemas/module.schema';

// ─────────────────────────────────────────
// Shared resource DTO (lesson & module level)
// ─────────────────────────────────────────
export class ResourceDto {
  @IsOptional()
  @IsString()
  url?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  fileType?: string;
}

// ─────────────────────────────────────────
// Quiz question DTO (per lesson)
// ─────────────────────────────────────────
export class QuizQuestionDto {
  @IsString()
  @IsNotEmpty()
  question: string;

  @IsString()
  @IsEnum(['multiple-choice', 'true-false', 'short-answer'])
  type: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsString()
  @IsNotEmpty()
  answer: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsNumber()
  points?: number;
}

// ─────────────────────────────────────────
// Lesson DTO
// ─────────────────────────────────────────
export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  lessonName: string;

  @IsOptional()
  @IsString()
  lessonContent?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tasks?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliverables?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evaluationCriteria?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  assessmentQuiz?: QuizQuestionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceDto)
  lessonResources?: ResourceDto[];

  @IsOptional()
  @IsNumber()
  order?: number;
}

// ─────────────────────────────────────────
// Topic DTO
// ─────────────────────────────────────────
export class CreateTopicDto {
  @IsString()
  @IsNotEmpty()
  topicName: string;

  @IsOptional()
  @IsString()
  introduction?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicOutcomes?: string[];

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLessonDto)
  lessons?: CreateLessonDto[];

  @IsOptional()
  @IsNumber()
  order?: number;
}

// ─────────────────────────────────────────
// Case Study Lesson DTO (content only)
// ─────────────────────────────────────────
export class CaseStudyLessonDto {
  @IsString()
  @IsEnum(['Introduction', 'Dataset', 'AI Task', 'Key Readings'])
  lessonType: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceDto)
  resources?: ResourceDto[];
}

// ─────────────────────────────────────────
// Case Study DTO
// ─────────────────────────────────────────
export class CreateCaseStudyDto {
  @IsString()
  @IsNotEmpty()
  caseStudyName: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CaseStudyLessonDto)
  lessons?: CaseStudyLessonDto[];

  @IsOptional()
  @IsString()
  note?: string;
}

// ─────────────────────────────────────────
// Final Assessment Question DTO
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// Final Assessment DTO
// ─────────────────────────────────────────
export class FinalAssessmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

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

// ─────────────────────────────────────────
// Create Module DTO
// ─────────────────────────────────────────
export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string; // introduction

  @IsOptional()
  @IsString()
  capstone?: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsEnum(ModuleLevel)
  @IsNotEmpty()
  level: ModuleLevel;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTopicDto)
  topics?: CreateTopicDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCaseStudyDto)
  caseStudies?: CreateCaseStudyDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FinalAssessmentDto)
  finalAssessment?: FinalAssessmentDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceDto)
  moduleResources?: ResourceDto[];

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
}
