import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BulkEmailDocument = BulkEmail & Document;

export enum BulkEmailStatus {
  SENDING = 'sending',
  SENT = 'sent',
  PARTIAL = 'partial',
  FAILED = 'failed',
}

export enum BulkEmailRecipientStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

export enum BulkEmailFilterType {
  ALL_FELLOWS = 'all_fellows',
  BY_CATEGORY = 'by_category',
  BY_COHORT = 'by_cohort',
  ALL_STUDENTS = 'all_students',
  ALL_INSTRUCTORS = 'all_instructors',
  MANUAL = 'manual',
}

@Schema({ _id: false })
export class BulkEmailRecipient {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    enum: Object.values(BulkEmailRecipientStatus),
    default: BulkEmailRecipientStatus.PENDING,
  })
  status: BulkEmailRecipientStatus;

  @Prop({ type: Date, default: null })
  sentAt?: Date;

  @Prop({ type: String, default: null })
  error?: string;
}

export const BulkEmailRecipientSchema =
  SchemaFactory.createForClass(BulkEmailRecipient);

@Schema({ _id: false })
export class BulkEmailAttachment {
  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ type: Number, default: 0 })
  size: number;
}

export const BulkEmailAttachmentSchema =
  SchemaFactory.createForClass(BulkEmailAttachment);

@Schema({ _id: false })
export class BulkEmailCcBcc {
  @Prop({ required: true })
  email: string;

  @Prop({ type: String, default: null })
  name?: string;
}

export const BulkEmailCcBccSchema = SchemaFactory.createForClass(BulkEmailCcBcc);

@Schema({ timestamps: true })
export class BulkEmail extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  senderName: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  body: string; // HTML content

  /** Filter used to build recipient list */
  @Prop({
    required: true,
    enum: Object.values(BulkEmailFilterType),
    default: BulkEmailFilterType.ALL_FELLOWS,
  })
  filterType: BulkEmailFilterType;

  /** Optional category/cohort IDs used when filterType = BY_CATEGORY or BY_COHORT */
  @Prop({ type: [Types.ObjectId], ref: 'Category', default: [] })
  filterCategoryIds: Types.ObjectId[];

  /** Cohort names used when filterType = BY_COHORT */
  @Prop({ type: [String], default: [] })
  filterCohorts: string[];

  /** Per-recipient delivery tracking */
  @Prop({ type: [BulkEmailRecipientSchema], default: [] })
  recipients: BulkEmailRecipient[];

  /** CC recipients (manually added) */
  @Prop({ type: [BulkEmailCcBccSchema], default: [] })
  cc: BulkEmailCcBcc[];

  /** BCC recipients (manually added) */
  @Prop({ type: [BulkEmailCcBccSchema], default: [] })
  bcc: BulkEmailCcBcc[];

  /** File attachments uploaded to Cloudinary */
  @Prop({ type: [BulkEmailAttachmentSchema], default: [] })
  attachments: BulkEmailAttachment[];

  @Prop({
    required: true,
    enum: Object.values(BulkEmailStatus),
    default: BulkEmailStatus.SENDING,
  })
  status: BulkEmailStatus;

  @Prop({ default: 0 })
  totalRecipients: number;

  @Prop({ default: 0 })
  sentCount: number;

  @Prop({ default: 0 })
  failedCount: number;

  @Prop({ type: Date, default: null })
  completedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const BulkEmailSchema = SchemaFactory.createForClass(BulkEmail);

BulkEmailSchema.index({ senderId: 1, createdAt: -1 });
BulkEmailSchema.index({ status: 1 });
BulkEmailSchema.index({ createdAt: -1 });
