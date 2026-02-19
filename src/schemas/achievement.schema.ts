import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AchievementType = 'module_completion' | 'course_completion' | 'xp_boost';

@Schema({ timestamps: true })
export class Achievement extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Enrollment' })
  enrollmentId?: Types.ObjectId;

  @Prop({ required: true, enum: ['module_completion', 'course_completion', 'xp_boost'] })
  type: AchievementType;

  @Prop()
  title?: string;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  xpAwarded: number;

  @Prop()
  moduleIndex?: number;

  @Prop()
  moduleTitle?: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const AchievementSchema = SchemaFactory.createForClass(Achievement);

// Compound unique index that includes enrollmentId to support multiple course attempts
// This allows the same student to earn achievements for the same module/course across different attempts
AchievementSchema.index({ studentId: 1, courseId: 1, enrollmentId: 1, type: 1, moduleIndex: 1 }, { unique: true, sparse: true });

// Additional indexes for queries
AchievementSchema.index({ studentId: 1, createdAt: -1 });
AchievementSchema.index({ enrollmentId: 1 });
