import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ActivityType {
  USER_REGISTRATION = 'user_registration',
  USER_UPDATED = 'user_updated',
  INSTRUCTOR_APPROVED = 'instructor_approved',
  INSTRUCTOR_REJECTED = 'instructor_rejected',
  COURSE_APPROVED = 'course_approved',
  COURSE_REJECTED = 'course_rejected',
  COURSE_CREATED = 'course_created',
  COURSE_UPDATED = 'course_updated',
  COURSE_DELETED = 'course_deleted',
  FILE_UPLOADED = 'file_uploaded',
  FILE_DELETED = 'file_deleted',
  USER_ACTIVATED = 'user_activated',
  USER_DEACTIVATED = 'user_deactivated',
  USER_DELETED = 'user_deleted',
  STUDENT_CREATED = 'student_created',
  STUDENT_UPDATED = 'student_updated',
  STUDENT_DELETED = 'student_deleted',
  FELLOW_REMINDER_SENT = 'fellow_reminder_sent',
}

@Schema({ timestamps: true })
export class ActivityLog extends Document {
  @Prop({ enum: ActivityType, required: true })
  type: ActivityType;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  performedBy: Types.ObjectId; // Admin who performed the action

  @Prop({ type: Types.ObjectId, ref: 'User' })
  targetUser?: Types.ObjectId; // User affected by the action

  @Prop({ type: Types.ObjectId, ref: 'Course' })
  targetCourse?: Types.ObjectId; // Course affected by the action

  @Prop({ type: Object })
  metadata?: Record<string, any>; // Additional data like rejection reason, etc.

  @Prop({ default: null })
  icon?: string; // Icon name for UI display

  // Timestamps (managed by mongoose)
  createdAt: Date;
  updatedAt: Date;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);

// Create indexes for better query performance
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ type: 1 });
ActivityLogSchema.index({ performedBy: 1 });
ActivityLogSchema.index({ targetUser: 1 });
ActivityLogSchema.index({ targetCourse: 1 });
