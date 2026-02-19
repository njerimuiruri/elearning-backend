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

// Question class (reused across assessments)
export class Question {
  @Prop({ required: true })
  text: string;

  @Prop({ required: true, enum: ['multiple-choice', 'essay', 'true-false'] })
  type: string;

  @Prop({ required: true })
  points: number;

  @Prop([String])
  options?: string[];

  @Prop()
  correctAnswer?: string;

  @Prop()
  explanation?: string;

  @Prop()
  rubric?: string; // For AI essay grading
}

// Lesson Assessment (Optional per lesson)
export class LessonAssessment {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: [Question], default: [] })
  questions: Question[];

  @Prop({ default: 70 })
  passingScore: number;

  @Prop({ default: 3 })
  maxAttempts: number; // -1 for unlimited
}

// Lesson resource (stores URL + display name + file type)
export class LessonResource {
  url: string;
  name: string;
  fileType?: string; // e.g. 'pdf', 'docx', 'pptx'
}

// Lesson schema
export class Lesson {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  content?: string;

  @Prop()
  videoUrl?: string;

  @Prop()
  duration?: string; // e.g., "45 minutes"

  @Prop({
    type: [{ url: String, name: { type: String, default: 'Resource' }, fileType: String }],
    default: [],
  })
  resources?: LessonResource[]; // Downloadable resources with name metadata

  @Prop({ type: LessonAssessment })
  assessment?: LessonAssessment; // Optional assessment per lesson

  @Prop({ default: 0 })
  order: number;

  // Lock/collaboration fields
  @Prop({ type: Types.ObjectId, ref: 'User' })
  lockedBy?: Types.ObjectId;

  @Prop()
  lockedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastEditedBy?: Types.ObjectId;

  @Prop()
  lastEditedAt?: Date;
}

// Module Final Assessment (Required)
export class ModuleFinalAssessment {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: [Question], default: [] })
  questions: Question[];

  @Prop({ default: 70 })
  passingScore: number;

  @Prop({ default: 3 })
  maxAttempts: number; // -1 for unlimited

  @Prop()
  timeLimit?: number; // in minutes, optional
}

@Schema({ timestamps: true })
export class Module extends Document {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  description: string;

  // Category (determines pricing)
  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  // Level - determines progression order
  @Prop({ enum: ModuleLevel, required: true })
  level: ModuleLevel;

  // Status workflow
  @Prop({ enum: ModuleStatus, default: ModuleStatus.DRAFT })
  status: ModuleStatus;

  // Instructor(s)
  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  instructorIds: Types.ObjectId[];

  // Module content
  @Prop({ type: [Lesson], default: [] })
  lessons: Lesson[];

  // Required final assessment
  @Prop({ type: ModuleFinalAssessment, required: false })
  finalAssessment?: ModuleFinalAssessment;

  // Metadata
  @Prop()
  bannerUrl?: string;

  @Prop()
  duration?: string; // Total estimated duration

  @Prop({ type: [String], default: [] })
  prerequisites?: string[]; // Array of prerequisite module IDs

  @Prop({ type: [String], default: [] })
  learningOutcomes: string[];

  @Prop({ type: [String], default: [] })
  targetAudience: string[];

  // New fields per ADMIN_SYSTEM.md
  @Prop()
  welcomeMessage?: string;

  @Prop()
  deliveryMode?: string;

  @Prop()
  moduleAim?: string;

  @Prop({ type: [String], default: [] })
  moduleObjectives: string[];

  // Approval workflow
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

  // Analytics
  @Prop({ default: 0 })
  enrollmentCount: number;

  @Prop({ default: 0 })
  completionRate: number;

  @Prop({ default: true })
  isActive: boolean;

  // Lock management
  @Prop({ type: Types.ObjectId, ref: 'User' })
  lockedBy?: Types.ObjectId;

  @Prop()
  lockedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastEditedBy?: Types.ObjectId;

  @Prop()
  lastEditedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ModuleSchema = SchemaFactory.createForClass(Module);

// Indexes
ModuleSchema.index({ categoryId: 1 });
ModuleSchema.index({ level: 1 });
ModuleSchema.index({ status: 1 });
ModuleSchema.index({ instructorIds: 1 });
ModuleSchema.index({ createdAt: -1 });
ModuleSchema.index({ categoryId: 1, level: 1, status: 1 }); // Compound for filtering
