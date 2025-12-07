import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

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

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop({ default: null })
  completedAt?: Date;

  @Prop({ default: null })
  lastAccessedAt?: Date;

  @Prop({ default: 0 })
  totalScore: number;

  @Prop({ default: null })
  certificateId?: Types.ObjectId;

  @Prop({ default: false })
  certificateEarned: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);

// Create indexes
EnrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
EnrollmentSchema.index({ courseId: 1 });
EnrollmentSchema.index({ isCompleted: 1 });
