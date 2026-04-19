import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Append-only record of a single lesson being completed.
 *
 * Design rules:
 *  - One document is created per (enrollmentId, lessonIndex, repeatGeneration).
 *  - It is NEVER updated or deleted — completion is permanent for that generation.
 *  - A module-repeat cycle increments repeatGeneration on the enrollment, making
 *    old completion records invisible to the current pass without destroying them.
 *  - Progress is always derived by COUNTing these records, never from a mutable flag.
 */
@Schema({ timestamps: true })
export class LessonCompletion extends Document {
  @Prop({ type: Types.ObjectId, ref: 'ModuleEnrollment', required: true, index: true })
  enrollmentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module', required: true })
  moduleId: Types.ObjectId;

  @Prop({ required: true })
  lessonIndex: number;

  /**
   * Tracks which module-repeat cycle this completion belongs to.
   * Starts at 0 (first attempt). When a module repeat is triggered, the
   * enrollment's moduleRepeatGeneration is incremented, causing the next
   * pass of lessons to create fresh completion records (same lesson index,
   * different generation).
   */
  @Prop({ required: true, default: 0 })
  repeatGeneration: number;

  @Prop({ required: true })
  completedAt: Date;

  createdAt: Date;
}

export const LessonCompletionSchema = SchemaFactory.createForClass(LessonCompletion);

// Unique: a lesson can only be completed once per generation per enrollment
LessonCompletionSchema.index(
  { enrollmentId: 1, lessonIndex: 1, repeatGeneration: 1 },
  { unique: true },
);
