import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum CourseStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum CourseLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
}

class Question {
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
}

class Lesson {
  @Prop({ required: true })
  title: string;

  @Prop()
  content?: string;

  @Prop()
  videoUrl?: string;

  @Prop()
  duration?: string;

  @Prop([String])
  topics?: string[];

  @Prop({ type: [Question], default: [] })
  questions?: Question[];
}

class Assessment {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: [Question], default: [] })
  questions: Question[];

  @Prop({ default: 70 })
  passingScore: number; // Percentage

  @Prop({ default: 0 })
  order: number;
}

class Module {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  content: string;

  @Prop()
  videoUrl?: string;

  @Prop()
  duration: number; // in minutes

  @Prop({ type: [Lesson], default: [] })
  lessons?: Lesson[];

  @Prop({ type: [Question], default: [] })
  questions: Question[];

  @Prop({ type: Assessment, required: false })
  moduleAssessment?: Assessment;

  @Prop({ default: 0 })
  order: number;
}

@Schema({ timestamps: true })

export class Course extends Document {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  category: string;

  // Support one or more instructors
  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  instructorIds: Types.ObjectId[];

  @Prop({ enum: CourseLevel, default: CourseLevel.BEGINNER })
  level: CourseLevel;

  @Prop({ enum: CourseStatus, default: CourseStatus.DRAFT })
  status: CourseStatus;

  @Prop({ type: [Module], default: [] })
  modules: Module[];

  @Prop({ type: Assessment, required: false })
  finalAssessment?: Assessment;

  @Prop({ default: 0 })
  totalPoints: number;

  @Prop({ default: 70 })
  passingScore: number; // Percentage

  @Prop()
  thumbnailUrl?: string;

  @Prop()
  courseTemplate?: string; // Reference to course template

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  rejectionReason?: string;

  @Prop({ default: 0 })
  enrollmentCount: number;

  @Prop({ default: 0 })
  completionRate: number;

  @Prop({ type: [String], default: [] })
  requirements: string[];

  @Prop({ type: [String], default: [] })
  targetAudience: string[];

  @Prop({ default: null })
  submittedAt?: Date;

  @Prop({ default: null })
  approvedAt?: Date;

  @Prop({ default: null })
  publishedAt?: Date;

  @Prop({ default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const CourseSchema = SchemaFactory.createForClass(Course);

// Create indexes
CourseSchema.index({ instructorIds: 1 });
CourseSchema.index({ status: 1 });
CourseSchema.index({ category: 1 });
CourseSchema.index({ createdAt: -1 });
CourseSchema.index({ 'modules.questions._id': 1 });
