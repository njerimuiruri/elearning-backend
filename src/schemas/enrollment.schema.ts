import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as crypto from 'crypto';

class ModuleProgress {
  @Prop({ required: true })
  moduleIndex: number;

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop({ default: 0 })
  assessmentAttempts: number;

  @Prop({ default: false })
  assessmentPassed: boolean;

  @Prop({ default: 0 })
  lastScore: number;

  @Prop({ default: null })
  completedAt?: Date;
}

// Store detailed assessment results per attempt
class AssessmentResult {
  @Prop({ required: true, default: 0 })
  attemptNumber: number;

  @Prop({ required: true })
  questionIndex: number;

  @Prop({ required: true })
  questionText: string;

  @Prop({ required: true, enum: ['multiple-choice', 'true-false', 'essay'] })
  questionType: string;

  @Prop({ required: true })
  studentAnswer: string; // Student's answer

  @Prop() // Optional for open-ended questions
  correctAnswer?: string;

  @Prop({ default: false })
  isCorrect: boolean; // false initially for essays, updated by instructor

  @Prop() // Auto-calculated for closed-ended, set by instructor for essays
  explanation?: string;

  @Prop({ default: 0 })
  pointsEarned: number;

  @Prop({ default: 0 })
  maxPoints: number;

  @Prop() // Instructor feedback for open-ended questions
  instructorFeedback?: string;

  @Prop({ default: null })
  gradedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  gradedBy?: Types.ObjectId; // Instructor who graded

  // AI Evaluation Fields (for essay questions)
  @Prop({ default: 0 })
  aiScore?: number; // 0-100 AI evaluation score

  @Prop({ default: 0 })
  aiConfidence?: number; // 0-100 AI confidence in evaluation

  @Prop()
  aiGradingStatus?: 'auto_passed' | 'auto_failed' | 'requires_review';

  @Prop()
  aiFeedback?: string; // AI-generated feedback

  @Prop([String])
  aiIdentifiedStrengths?: string[]; // Strengths identified by AI

  @Prop([String])
  aiIdentifiedWeaknesses?: string[]; // Areas for improvement by AI

  @Prop([String])
  aiKeyConceptsFound?: string[]; // Key concepts AI identified

  @Prop({ default: 0 })
  aiSemanticMatch?: number; // 0-100 semantic similarity score

  @Prop({ default: 0 })
  aiContentRelevance?: number; // 0-100 relevance score

  @Prop({ default: 0 })
  aiPlagiarismRisk?: number; // 0-100 plagiarism risk score

  @Prop([String])
  aiCheatingIndicators?: string[]; // Potential cheating patterns detected

  @Prop({ default: null })
  aiEvaluatedAt?: Date; // When AI evaluation was performed
}

// Historical record of course attempts
class CourseAttemptHistory {
  @Prop({ required: true })
  attemptNumber: number;

  @Prop({ required: true })
  resetReason: string; // 'manual_restart', 'auto_restart_module_failure', 'auto_restart_final_failure', 'soft_reset'

  @Prop({ required: true })
  resetAt: Date;

  @Prop({ default: 0 })
  progressAtReset: number;

  @Prop({ default: 0 })
  completedModulesAtReset: number;

  @Prop({ default: 0 })
  moduleAssessmentAttempts: number;

  @Prop({ default: 0 })
  finalAssessmentAttempts: number;

  @Prop({ default: 0 })
  highestModuleScore: number;

  @Prop({ default: 0 })
  highestFinalScore: number;

  @Prop({ type: [ModuleProgress], default: [] })
  moduleProgressSnapshot: ModuleProgress[];
}

@Schema({ timestamps: true })
export class Enrollment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ default: 0 })
  progress: number; // Percentage

  @Prop({ default: 0 })
  completedModules: number;

  @Prop({ type: [ModuleProgress], default: [] })
  moduleProgress: ModuleProgress[];

  @Prop({ default: 0 })
  finalAssessmentAttempts: number;

  @Prop({ default: false })
  finalAssessmentPassed: boolean;

  @Prop({ default: 0 })
  finalAssessmentScore: number;

  // Store all assessment results (detailed per question)
  @Prop({ type: [Object], default: [] })
  finalAssessmentResults?: Array<any>; // Array of AssessmentResult objects

  // Track pending manual grading count
  @Prop({ default: 0 })
  pendingManualGradingCount: number;

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop({ default: null })
  completedAt?: Date;

  @Prop({ default: null })
  lastAccessedAt?: Date;

  // Last lesson location for resume
  @Prop({ default: 0 })
  lastAccessedModule?: number;

  @Prop({ default: 0 })
  lastAccessedLesson?: number;

  // Track if student is currently in an assessment
  @Prop({ default: false })
  inModuleAssessment?: boolean;

  @Prop({ default: null })
  currentAssessmentModule?: number;

  @Prop({ default: false })
  inFinalAssessment?: boolean;

  // Track last activity type for smart resume
  @Prop({ enum: ['lesson', 'module_assessment', 'final_assessment'], default: 'lesson' })
  lastActivityType?: string;

  // Per-lesson completion tracking
  @Prop({
    type: [
      {
        moduleIndex: { type: Number, required: true },
        lessonIndex: { type: Number, required: true },
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
      },
    ],
    default: [],
  })
  lessonProgress?: Array<{
    moduleIndex: number;
    lessonIndex: number;
    isCompleted: boolean;
    completedAt?: Date | null;
  }>;

  @Prop({ default: 0 })
  totalScore: number;

  @Prop({ default: null })
  certificateId?: Types.ObjectId;

  @Prop({ type: String, default: null })
  certificatePublicId?: string; // UUID for secure certificate access

  @Prop({ default: false })
  certificateEarned: boolean;

  @Prop()
  certificateUrl?: string;

  @Prop({ default: null })
  certificateIssuedAt?: Date;

  // Historical data for analytics and instructor review
  @Prop({ type: [Object], default: [] })
  attemptHistory?: CourseAttemptHistory[];

  @Prop({ default: 1 })
  currentAttemptNumber: number;

  createdAt: Date;
  updatedAt: Date;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);

// Generate certificate public ID when certificate is earned
EnrollmentSchema.pre('save', function(next) {
  if (this.certificateEarned && !this.certificatePublicId) {
    this.certificatePublicId = crypto.randomUUID();
  }
  next();
});

// Create indexes
EnrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
EnrollmentSchema.index({ courseId: 1 });
EnrollmentSchema.index({ isCompleted: 1 });
EnrollmentSchema.index({ certificatePublicId: 1 }, { unique: true, sparse: true, partialFilterExpression: { certificatePublicId: { $ne: null } } });
