import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as crypto from 'crypto';

// Per-slide progress tracking
export class SlideProgress {
  @Prop({ required: true })
  slideIndex: number;

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop({ default: 0 })
  timeSpent: number; // seconds viewed

  @Prop({ default: false })
  scrolledToBottom: boolean;

  @Prop()
  completedAt?: Date;
}

// Lesson progress tracking
export class LessonProgress {
  @Prop({ required: true })
  lessonIndex: number;

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop()
  completedAt?: Date;

  // Slide-level tracking
  @Prop({
    type: [
      {
        slideIndex: { type: Number, required: true },
        isCompleted: { type: Boolean, default: false },
        timeSpent: { type: Number, default: 0 },
        scrolledToBottom: { type: Boolean, default: false },
        completedAt: Date,
      },
    ],
    default: [],
  })
  slideProgress: SlideProgress[];

  @Prop({ default: 0 })
  completedSlides: number;

  // Last slide the student viewed in this lesson (for resume)
  @Prop({ default: 0 })
  lastAccessedSlide: number;

  // If lesson has assessment
  @Prop({ default: 0 })
  assessmentAttempts: number;

  @Prop({ default: false })
  assessmentPassed: boolean;

  @Prop({ default: 0 })
  lastScore: number;

  // Student's last submitted answers for quiz review (keyed by question index string)
  @Prop({ type: Object, default: null })
  lastAnswers?: Record<string, string>;
}

// Assessment result per attempt
export class AssessmentResult {
  @Prop({ required: true, default: 0 })
  attemptNumber: number;

  @Prop({ required: true })
  questionIndex: number;

  @Prop({ required: true })
  questionText: string;

  @Prop({ required: true })
  questionType: string;

  @Prop({ required: true })
  studentAnswer: string;

  @Prop()
  correctAnswer?: string;

  @Prop({ default: false })
  isCorrect: boolean;

  @Prop()
  explanation?: string;

  @Prop({ default: 0 })
  pointsEarned: number;

  @Prop({ default: 0 })
  maxPoints: number;

  @Prop()
  instructorFeedback?: string;

  @Prop()
  gradedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  gradedBy?: Types.ObjectId;

  // AI grading fields (for essay questions)
  @Prop({ default: 0 })
  aiScore?: number;

  @Prop({ default: 0 })
  aiConfidence?: number;

  @Prop()
  aiGradingStatus?: 'auto_passed' | 'auto_failed' | 'requires_review';

  @Prop()
  aiFeedback?: string;

  @Prop()
  aiStrengths?: string;

  @Prop()
  aiWeaknesses?: string;
}

@Schema({ timestamps: true })
export class ModuleEnrollment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module', required: true })
  moduleId: Types.ObjectId;

  // Progress tracking
  @Prop({ default: 0 })
  progress: number; // Percentage (0-100)

  @Prop({ type: [LessonProgress], default: [] })
  lessonProgress: LessonProgress[];

  @Prop({ default: 0 })
  completedLessons: number;

  @Prop({ default: 0 })
  totalLessons: number;

  // Final assessment tracking
  @Prop({ default: 0 })
  finalAssessmentAttempts: number;

  @Prop({ default: false })
  finalAssessmentPassed: boolean;

  @Prop({ default: 0 })
  finalAssessmentScore: number;

  @Prop({ type: [Object], default: [] })
  finalAssessmentResults?: AssessmentResult[];

  @Prop({ default: 0 })
  pendingManualGradingCount: number;

  // Essay assessment review
  @Prop({ default: false })
  pendingInstructorReview: boolean;

  @Prop({ type: Date, default: null })
  essaySubmittedAt?: Date;

  // Module repeat enforcement (legacy — no longer triggered, kept for DB compat)
  @Prop({ default: false })
  requiresModuleRepeat: boolean;

  // How many times the student has exhausted their attempts (for analytics)
  @Prop({ default: 0 })
  moduleRepeatCount: number;

  // Cooldown: set after exhausting all attempts in a round.
  // Student cannot submit again until this timestamp passes.
  @Prop({ type: Date, default: null })
  assessmentCooldownUntil?: Date | null;

  /**
   * Incremented each time a module repeat is triggered (final assessment
   * max attempts exhausted). LessonCompletion records are scoped to this
   * generation so old completions are never deleted — they become part of
   * the student's history while the current pass starts fresh.
   */
  @Prop({ default: 0 })
  moduleRepeatGeneration: number;

  // Completion status
  @Prop({ default: false })
  isCompleted: boolean;

  @Prop()
  completedAt?: Date;

  // Certificate
  @Prop({ default: false })
  certificateEarned: boolean;

  @Prop({ type: String })
  certificatePublicId?: string;

  @Prop()
  certificateIssuedAt?: Date;

  // Navigation state
  @Prop()
  lastAccessedAt?: Date;

  @Prop({ default: 0 })
  lastAccessedLesson?: number;

  @Prop({ default: false })
  inFinalAssessment?: boolean;

  @Prop({ default: 0 })
  totalScore: number;

  createdAt: Date;
  updatedAt: Date;
}

export const ModuleEnrollmentSchema =
  SchemaFactory.createForClass(ModuleEnrollment);

// Generate certificate public ID when certificate is earned
ModuleEnrollmentSchema.pre('save', function (next) {
  if (this.certificateEarned && !this.certificatePublicId) {
    this.certificatePublicId = crypto.randomUUID();
  }
  next();
});

// Indexes
ModuleEnrollmentSchema.index({ studentId: 1, moduleId: 1 }, { unique: true });
ModuleEnrollmentSchema.index({ moduleId: 1 });
ModuleEnrollmentSchema.index({ studentId: 1 });
ModuleEnrollmentSchema.index({ isCompleted: 1 });
ModuleEnrollmentSchema.index(
  { certificatePublicId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { certificatePublicId: { $ne: null } },
  },
);
