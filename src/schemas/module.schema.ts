import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ModuleStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum ModuleLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
}

export enum AssessmentReviewStatus {
  NONE = 'none',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum SlideType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  DIAGRAM = 'diagram',
  CODE_SNIPPET = 'codeSnippet',
}

// ─────────────────────────────────────────
// Slide (belongs inside a Lesson)
// ─────────────────────────────────────────
export class Slide {
  @Prop({ required: true, enum: Object.values(SlideType) })
  type!: SlideType;

  @Prop({ default: 0 })
  order!: number;

  // Text / Diagram content (HTML/rich text)
  @Prop()
  content?: string;

  // Image
  @Prop()
  imageUrl?: string;

  @Prop()
  imageCaption?: string;

  // Video
  @Prop()
  videoUrl?: string;

  @Prop()
  videoCaption?: string;

  // Code Snippet (interactive)
  @Prop({ enum: ['python', 'r'] })
  codeLanguage?: string;

  @Prop()
  codeInstructions?: string;

  @Prop()
  starterCode?: string;

  @Prop()
  expectedOutput?: string;

  // Engagement settings
  @Prop({ default: 15 })
  minViewingTime!: number; // seconds

  @Prop({ default: false })
  scrollTrackingEnabled!: boolean;
}

// ─────────────────────────────────────────
// Quiz Question (per lesson assessment)
// ─────────────────────────────────────────
export class QuizQuestion {
  @Prop({ required: true })
  question!: string;

  @Prop({ required: true, enum: ['multiple-choice', 'true-false', 'short-answer'] })
  type!: string;

  @Prop([String])
  options?: string[];

  @Prop({ required: true })
  answer!: string;

  @Prop()
  explanation?: string;

  @Prop({ default: 1 })
  points?: number;
}

// ─────────────────────────────────────────
// Lesson Resource
// ─────────────────────────────────────────
export class LessonResource {
  @Prop()
  url?: string;

  @Prop({ default: 'Resource' })
  name!: string;

  @Prop()
  description?: string;

  @Prop()
  fileType?: string;
}

// ─────────────────────────────────────────
// ModuleLesson — direct child of a Module
// Structure: Category → Module → Lesson → Slides
// ─────────────────────────────────────────
export class ModuleLesson {
  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  learningOutcomes!: string[];

  // Slides (ordered content blocks)
  @Prop({
    type: [
      {
        type: { type: String, enum: Object.values(SlideType), required: true },
        order: { type: Number, default: 0 },
        content: String,
        imageUrl: String,
        imageCaption: String,
        videoUrl: String,
        videoCaption: String,
        codeLanguage: { type: String, enum: ['python', 'r'] },
        codeInstructions: String,
        starterCode: String,
        expectedOutput: String,
        minViewingTime: { type: Number, default: 15 },
        scrollTrackingEnabled: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  slides!: Slide[];

  // Lesson assessment (quiz at end of lesson)
  @Prop({
    type: [
      {
        question: String,
        type: { type: String, enum: ['multiple-choice', 'true-false', 'short-answer'] },
        options: [String],
        answer: String,
        explanation: String,
        points: { type: Number, default: 1 },
      },
    ],
    default: [],
  })
  assessmentQuiz!: QuizQuestion[];

  @Prop({ default: 70 })
  quizPassingScore!: number;

  @Prop({ default: 3 })
  quizMaxAttempts!: number;

  @Prop({
    type: [{ url: String, name: { type: String, default: 'Resource' }, description: String, fileType: String }],
    default: [],
  })
  lessonResources!: LessonResource[];

  @Prop({ default: 0 })
  order!: number;

  @Prop()
  duration?: string;
}

// ─────────────────────────────────────────
// Legacy: Lesson (belongs inside a Topic)
// Kept for backward compatibility
// ─────────────────────────────────────────
export class Lesson {
  @Prop({ required: true })
  lessonName!: string;

  @Prop()
  lessonContent?: string;

  @Prop()
  duration?: string;

  @Prop({ type: [String], default: [] })
  tasks!: string[];

  @Prop({ type: [String], default: [] })
  deliverables!: string[];

  @Prop({ type: [String], default: [] })
  evaluationCriteria!: string[];

  @Prop({
    type: [
      {
        question: String,
        type: { type: String, enum: ['multiple-choice', 'true-false', 'short-answer'] },
        options: [String],
        answer: String,
        explanation: String,
        points: { type: Number, default: 1 },
      },
    ],
    default: [],
  })
  assessmentQuiz!: QuizQuestion[];

  @Prop({ default: 70 })
  quizPassingScore!: number;

  @Prop({ default: 3 })
  quizMaxAttempts!: number;

  @Prop({
    type: [{ url: String, name: { type: String, default: 'Resource' }, description: String, fileType: String }],
    default: [],
  })
  lessonResources!: LessonResource[];

  @Prop({ default: 0 })
  order!: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lockedBy?: Types.ObjectId;

  @Prop()
  lockedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastEditedBy?: Types.ObjectId;

  @Prop()
  lastEditedAt?: Date;
}

// ─────────────────────────────────────────
// Legacy: Topic (groups lessons)
// Kept for backward compatibility
// ─────────────────────────────────────────
export class Topic {
  @Prop({ required: true })
  topicName!: string;

  @Prop()
  introduction?: string;

  @Prop({ type: [String], default: [] })
  topicOutcomes!: string[];

  @Prop()
  duration?: string;

  @Prop({ type: [Lesson], default: [] })
  lessons!: Lesson[];

  @Prop({ default: 0 })
  order!: number;
}

// ─────────────────────────────────────────
// Case Study Lesson (content-only, no quiz)
// ─────────────────────────────────────────
export class CaseStudyLesson {
  @Prop({ required: true, enum: ['Introduction', 'Dataset', 'AI Task', 'Key Readings'] })
  lessonType!: string;

  @Prop()
  content?: string;

  @Prop({
    type: [{ url: String, name: { type: String, default: 'Resource' }, description: String, fileType: String }],
    default: [],
  })
  resources!: LessonResource[];
}

// ─────────────────────────────────────────
// Case Study
// ─────────────────────────────────────────
export class CaseStudy {
  @Prop({ required: true })
  caseStudyName!: string;

  @Prop({ type: [CaseStudyLesson], default: [] })
  lessons!: CaseStudyLesson[];

  @Prop({ default: 'Case studies do not have quizzes; they only provide content.' })
  note?: string;
}

// ─────────────────────────────────────────
// Module Resource (module-level)
// ─────────────────────────────────────────
export class ModuleResource {
  @Prop()
  url?: string;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop()
  fileType?: string;
}

// ─────────────────────────────────────────
// Final Assessment Question
// ─────────────────────────────────────────
export class Question {
  @Prop({ required: true })
  text!: string;

  @Prop({ required: true, enum: ['multiple-choice', 'essay', 'true-false'] })
  type!: string;

  @Prop({ required: true })
  points!: number;

  @Prop([String])
  options?: string[];

  @Prop()
  correctAnswer?: string;

  @Prop()
  explanation?: string;

  @Prop()
  rubric?: string;
}

// ─────────────────────────────────────────
// Final Assessment
// ─────────────────────────────────────────
export class ModuleFinalAssessment {
  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop()
  instructions?: string;

  @Prop({ type: [Question], default: [] })
  questions!: Question[];

  @Prop({ default: 70 })
  passingScore!: number;

  @Prop({ default: 3 })
  maxAttempts!: number;

  @Prop()
  timeLimit?: number;
}

// ─────────────────────────────────────────
// Module (top level)
// Hierarchy: Category → Module → Lesson → Slide
// ─────────────────────────────────────────
@Schema({ timestamps: true })
export class Module extends Document {
  @Prop({ required: true, trim: true })
  declare title: string;

  @Prop({ required: true })
  declare description: string;

  @Prop()
  capstone?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  declare categoryId: Types.ObjectId;

  @Prop({ enum: ModuleLevel, required: true })
  declare level: ModuleLevel;

  @Prop({ enum: ModuleStatus, default: ModuleStatus.DRAFT })
  declare status: ModuleStatus;

  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  declare instructorIds: Types.ObjectId[];

  // ── NEW: Direct lessons (Category → Module → Lesson) ───────────────────
  @Prop({
    type: [
      {
        title: { type: String, required: true },
        description: String,
        learningOutcomes: [String],
        slides: [
          {
            type: { type: String, enum: Object.values(SlideType), required: true },
            order: { type: Number, default: 0 },
            content: String,
            imageUrl: String,
            imageCaption: String,
            videoUrl: String,
            videoCaption: String,
            codeLanguage: { type: String, enum: ['python', 'r'] },
            codeInstructions: String,
            starterCode: String,
            expectedOutput: String,
            minViewingTime: { type: Number, default: 15 },
            scrollTrackingEnabled: { type: Boolean, default: false },
          },
        ],
        assessmentQuiz: [
          {
            question: String,
            type: { type: String, enum: ['multiple-choice', 'true-false', 'short-answer'] },
            options: [String],
            answer: String,
            explanation: String,
            points: { type: Number, default: 1 },
          },
        ],
        quizPassingScore: { type: Number, default: 70 },
        quizMaxAttempts: { type: Number, default: 3 },
        lessonResources: [
          { url: String, name: { type: String, default: 'Resource' }, description: String, fileType: String },
        ],
        order: { type: Number, default: 0 },
        duration: String,
      },
    ],
    default: [],
  })
  declare lessons: ModuleLesson[];

  // ── LEGACY: Topics → Lessons (kept for backward compat) ────────────────
  @Prop({ type: [Topic], default: [] })
  declare topics: Topic[];

  @Prop({ type: [CaseStudy], default: [] })
  declare caseStudies: CaseStudy[];

  // ── Creator tracking ────────────────────────────────────────────────────
  /** The user (admin or instructor) who actually created the module record */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  /** 'admin' | 'instructor' — who created this module */
  @Prop({ type: String, enum: ['admin', 'instructor'], default: 'instructor' })
  createdByRole?: string;

  /**
   * Email of an instructor who does not yet have a User account.
   * When they register/are approved, their ObjectId is pushed into instructorIds
   * and this field is cleared.
   */
  @Prop()
  pendingInstructorEmail?: string;

  /** Display name for the pending (unregistered) instructor */
  @Prop()
  pendingInstructorName?: string;

  @Prop({ type: ModuleFinalAssessment, required: false })
  finalAssessment?: ModuleFinalAssessment;

  // ── Assessment review workflow ─────────────────────────────────────────
  @Prop({ enum: AssessmentReviewStatus, default: AssessmentReviewStatus.NONE })
  declare assessmentReviewStatus: AssessmentReviewStatus;

  @Prop()
  assessmentUpdatedAt?: Date;

  @Prop()
  assessmentRejectionReason?: string;

  // ── Module-level resources ─────────────────────────────────────────────
  @Prop({
    type: [{ url: String, name: String, description: String, fileType: String }],
    default: [],
  })
  declare moduleResources: ModuleResource[];

  // ── Metadata ───────────────────────────────────────────────────────────
  @Prop()
  bannerUrl?: string;

  @Prop()
  duration?: string;

  @Prop({ type: [String], default: [] })
  declare prerequisites: string[];

  @Prop({ type: [String], default: [] })
  declare learningOutcomes: string[];

  @Prop({ type: [String], default: [] })
  declare targetAudience: string[];

  // ── Approval workflow ──────────────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  rejectionReason?: string;

  @Prop()
  submittedAt?: Date;

  @Prop()
  approvedAt?: Date;

  @Prop()
  publishedAt?: Date;

  // ── Analytics ─────────────────────────────────────────────────────────
  @Prop({ default: 0 })
  declare enrollmentCount: number;

  @Prop({ default: 0 })
  declare completionRate: number;

  @Prop({ default: true })
  declare isActive: boolean;

  @Prop({ default: 0 })
  declare avgRating: number;

  @Prop({ default: 0 })
  declare totalRatings: number;

  // ── Lock management ────────────────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'User' })
  lockedBy?: Types.ObjectId;

  @Prop()
  lockedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastEditedBy?: Types.ObjectId;

  @Prop()
  lastEditedAt?: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ModuleSchema = SchemaFactory.createForClass(Module);

// Indexes
ModuleSchema.index({ categoryId: 1 });
ModuleSchema.index({ level: 1 });
ModuleSchema.index({ status: 1 });
ModuleSchema.index({ instructorIds: 1 });
ModuleSchema.index({ createdAt: -1 });
ModuleSchema.index({ categoryId: 1, level: 1, status: 1 });
ModuleSchema.index({ status: 1, isActive: 1, createdAt: -1 });
