import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BulkReminderDocument = BulkReminder & Document;

export enum BulkReminderFilterType {
  ALL = 'all',
  ASSESSMENT_PENDING = 'assessment_pending',
  ASSESSMENT_SUBMITTED = 'assessment_submitted',
  ASSESSMENT_PASSED = 'assessment_passed',
  ASSESSMENT_FAILED = 'assessment_failed',
  INACTIVE = 'inactive',
}

@Schema({ timestamps: true })
export class BulkReminder extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ required: true, enum: ['instructor', 'admin'] })
  senderRole: 'instructor' | 'admin';

  @Prop({ required: true })
  senderName: string;

  @Prop({ type: Types.ObjectId, ref: 'Module', default: null })
  moduleId?: Types.ObjectId;

  @Prop({ type: String, default: null })
  moduleName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', default: null })
  categoryId?: Types.ObjectId;

  @Prop({ type: String, default: null })
  categoryName?: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  message: string;

  @Prop({
    required: true,
    enum: Object.values(BulkReminderFilterType),
    default: BulkReminderFilterType.ALL,
  })
  filterType: string;

  @Prop({ type: Number, default: null })
  inactiveDays?: number;

  @Prop({ default: 0 })
  recipientCount: number;

  @Prop({ required: true, enum: ['students', 'instructors'], default: 'students' })
  recipientType: 'students' | 'instructors';

  createdAt: Date;
  updatedAt: Date;
}

export const BulkReminderSchema = SchemaFactory.createForClass(BulkReminder);

BulkReminderSchema.index({ senderId: 1, createdAt: -1 });
BulkReminderSchema.index({ moduleId: 1 });
BulkReminderSchema.index({ categoryId: 1 });
