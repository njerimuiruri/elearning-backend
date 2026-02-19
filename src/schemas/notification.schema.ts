import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  DISCUSSION_POST = 'discussion_post',
  DISCUSSION_REPLY = 'discussion_reply',
  ESSAY_SUBMITTED = 'essay_submitted',
  ESSAY_GRADED = 'essay_graded',
  INACTIVITY_REMINDER = 'inactivity_reminder',
  CERTIFICATE_EARNED = 'certificate_earned',
  LEVEL_UNLOCKED = 'level_unlocked',
}

@Schema({ timestamps: true })
export class Notification extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(NotificationType) })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ type: String, default: null })
  link?: string;

  @Prop({ type: Types.ObjectId, default: null })
  relatedId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
