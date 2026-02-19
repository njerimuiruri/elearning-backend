import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsEnum } from 'class-validator';
import { CourseLevel } from '../../schemas/course.schema';

class QuestionDto {
  @IsString()
  @IsOptional()
  text?: string;

  // Frontend sometimes sends "question" instead of "text"; allow it and normalize before saving
  @IsString()
  @IsOptional()
  question?: string;

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

class AssessmentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  questions?: QuestionDto[];

  @IsNumber()
  @IsOptional()
  passingScore?: number;
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

  @IsOptional()
  moduleAssessment?: AssessmentDto;
}

export class CreateCourseDto {
    @IsString()
    @IsOptional()
    welcomeMessage?: string;

    @IsString()
    @IsOptional()
    audienceDescription?: string;

    @IsString()
    @IsOptional()
    deliveryMode?: string;

    @IsString()
    @IsOptional()
    courseAim?: string;

    @IsString()
    @IsOptional()
    courseObjective?: string;

    @IsString()
    @IsOptional()
    expectedLearningOutcomes?: string;

    @IsString()
    @IsOptional()
    briefContent?: string;

    @IsString()
    @IsOptional()
    teachingLearningMethods?: string;

    @IsString()
    @IsOptional()
    resourcesMaterials?: string;

    @IsString()
    @IsOptional()
    assessmentPlan?: string;

    @IsString()
    @IsOptional()
    supportingTechnologies?: string;

    @IsString()
    @IsOptional()
    coreTexts?: string;

    @IsString()
    @IsOptional()
    additionalReadings?: string;
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

  // Allow admin to specify multiple instructors (optional)
  @IsArray()
  @IsOptional()
  instructorIds?: string[];
  @IsArray()
  @IsOptional()
  modules?: ModuleDto[];

  @IsOptional()
  finalAssessment?: AssessmentDto;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsOptional()
  courseTemplate?: string;

  @IsArray()
  @IsOptional()
  requirements?: string[];

  @IsArray()
  @IsOptional()
  targetAudience?: string[];
}

export class UpdateCourseDto {
    @IsString()
    @IsOptional()
    welcomeMessage?: string;

    @IsString()
    @IsOptional()
    audienceDescription?: string;

    @IsString()
    @IsOptional()
    deliveryMode?: string;

    @IsString()
    @IsOptional()
    courseAim?: string;

    @IsString()
    @IsOptional()
    courseObjective?: string;

    @IsString()
    @IsOptional()
    expectedLearningOutcomes?: string;

    @IsString()
    @IsOptional()
    briefContent?: string;

    @IsString()
    @IsOptional()
    teachingLearningMethods?: string;

    @IsString()
    @IsOptional()
    resourcesMaterials?: string;

    @IsString()
    @IsOptional()
    assessmentPlan?: string;

    @IsString()
    @IsOptional()
    supportingTechnologies?: string;

    @IsString()
    @IsOptional()
    coreTexts?: string;

    @IsString()
    @IsOptional()
    additionalReadings?: string;
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

  // Allow admin to update instructors (optional)
  @IsArray()
  @IsOptional()
  instructorIds?: string[];
  @IsArray()
  @IsOptional()
  modules?: ModuleDto[];

  @IsOptional()
  finalAssessment?: AssessmentDto;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsArray()
  @IsOptional()
  requirements?: string[];

  @IsArray()
  @IsOptional()
  targetAudience?: string[];
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
