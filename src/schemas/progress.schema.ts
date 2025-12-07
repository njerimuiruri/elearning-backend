import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Progress extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Enrollment', required: true })
  enrollmentId: Types.ObjectId;

  @Prop({ required: true })
  moduleIndex: number;

  @Prop({ default: false })
  moduleCompleted: boolean;

  @Prop({ default: 0 })
  moduleScore: number;

  @Prop({ type: [{ questionIndex: Number, score: Number, answered: Boolean }], default: [] })
  questionAnswers: any[];

  @Prop({ default: null })
  completedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ProgressSchema = SchemaFactory.createForClass(Progress);

// Create indexes
ProgressSchema.index({ studentId: 1, courseId: 1 });
ProgressSchema.index({ enrollmentId: 1 });
ProgressSchema.index({ courseId: 1, moduleIndex: 1 });
