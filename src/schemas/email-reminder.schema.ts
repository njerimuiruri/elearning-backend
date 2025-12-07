import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class EmailReminder extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Enrollment', required: true })
  enrollmentId: Types.ObjectId;

  @Prop({ required: true })
  reminderType: string; // 'weekly', 'incomplete', 'nearing-deadline'

  @Prop({ default: false })
  sent: boolean;

  @Prop({ default: null })
  sentAt?: Date;

  @Prop({ default: null })
  nextReminderDate?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const EmailReminderSchema = SchemaFactory.createForClass(EmailReminder);

// Create indexes
EmailReminderSchema.index({ studentId: 1, courseId: 1 });
EmailReminderSchema.index({ sent: 1 });
EmailReminderSchema.index({ nextReminderDate: 1 });
