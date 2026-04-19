import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
  IsBoolean,
  IsEmail,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ModuleLevel, SlideType } from '../../schemas/module.schema';

// ─────────────────────────────────────────
// Shared resource DTO (lesson & module level)
// ─────────────────────────────────────────
export class ResourceDto {
  @IsOptional()
  @IsString()
  url?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  fileType?: string;
}

// ─────────────────────────────────────────
// Slide DTO
// ─────────────────────────────────────────
export class SlideDto {
  @IsEnum(SlideType)
  @IsNotEmpty()
  type!: SlideType;

  @IsOptional()
  @IsNumber()
  order?: number;

  // Text / Diagram
  @IsOptional()
  @IsString()
  content?: string;

  // Image
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imageCaption?: string;

  // Video
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  videoCaption?: string;

  // Code Snippet
  @IsOptional()
  @IsEnum(['python', 'r'])
  codeLanguage?: string;

  @IsOptional()
  @IsString()
  codeInstructions?: string;

  @IsOptional()
  @IsString()
  starterCode?: string;

  @IsOptional()
  @IsString()
  expectedOutput?: string;

  // Engagement
  @IsOptional()
  @IsNumber()
  minViewingTime?: number;

  @IsOptional()
  @IsBoolean()
  scrollTrackingEnabled?: boolean;
}

// ─────────────────────────────────────────
// Quiz question DTO (per lesson)
// ─────────────────────────────────────────
export class QuizQuestionDto {
  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsEnum(['multiple-choice', 'true-false', 'short-answer'])
  type!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsString()
  @IsNotEmpty()
  answer!: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsNumber()
  points?: number;
}

// ─────────────────────────────────────────
// NEW: Module Lesson DTO (direct child of module)
// Hierarchy: Module → Lesson → Slides
// ─────────────────────────────────────────
export class CreateModuleLessonDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : value))
  @IsArray()
  @IsString({ each: true })
  learningOutcomes?: string[];

  @IsOptional()
  @IsString()
  slidesTitle?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlideDto)
  slides?: SlideDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  assessmentQuiz?: QuizQuestionDto[];

  @IsOptional()
  @IsNumber()
  quizPassingScore?: number;

  @IsOptional()
  @IsNumber()
  quizMaxAttempts?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceDto)
  lessonResources?: ResourceDto[];

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  duration?: string;
}

// ─────────────────────────────────────────
// Legacy Lesson DTO (inside topic)
// ─────────────────────────────────────────
export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  lessonName!: string;

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
// Topic DTO (legacy)
// ─────────────────────────────────────────
export class CreateTopicDto {
  @IsString()
  @IsNotEmpty()
  topicName!: string;

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
  lessonType!: string;

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
  caseStudyName!: string;

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
  text!: string;

  @IsString()
  @IsEnum(['multiple-choice', 'essay', 'true-false'])
  type!: string;

  @IsNumber()
  points!: number;

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
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];

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
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  capstone?: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsEnum(ModuleLevel)
  @IsNotEmpty()
  level!: ModuleLevel;

  // New: direct lessons
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateModuleLessonDto)
  lessons?: CreateModuleLessonDto[];

  // Legacy: topics
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
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : value))
  @IsArray()
  @IsString({ each: true })
  prerequisites?: string[];

  @IsOptional()
  @IsString()
  learningOutcomes?: string;

  @IsOptional()
  @IsString()
  learningObjectives?: string;

  @IsOptional()
  @IsString()
  moduleTopics?: string;

  @IsOptional()
  @IsString()
  coreReadingMaterials?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : value))
  @IsArray()
  @IsString({ each: true })
  targetAudience?: string[];

  @IsOptional()
  @IsBoolean()
  isContentFinalized?: boolean;

  // ── Admin-only: instructor assignment ─────────────────────────────────────
  /** ID of an existing instructor to assign as module owner (admin use only) */
  @IsOptional()
  @IsString()
  assignedInstructorId?: string;

  /** Email of a not-yet-registered instructor (admin use only) */
  @IsOptional()
  @IsEmail()
  pendingInstructorEmail?: string;

  /** Display name for the pending instructor (admin use only) */
  @IsOptional()
  @IsString()
  pendingInstructorName?: string;
}
