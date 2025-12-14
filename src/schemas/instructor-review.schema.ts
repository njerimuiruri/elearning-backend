import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class InstructorReview extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  instructorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ default: '' })
  comment: string;

  createdAt: Date;
  updatedAt: Date;
}

export const InstructorReviewSchema = SchemaFactory.createForClass(InstructorReview);

InstructorReviewSchema.index({ instructorId: 1 });
InstructorReviewSchema.index({ studentId: 1, courseId: 1, instructorId: 1 }, { unique: true });
