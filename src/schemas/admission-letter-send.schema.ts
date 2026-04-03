import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AdmissionLetterSendDocument = AdmissionLetterSend & Document;

export enum RecipientStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  OPENED = 'OPENED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
}

const RecipientSchema = new MongooseSchema(
  {
    fellowId: {
      type: MongooseSchema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email: { type: String, required: true },
    name: { type: String },
    status: {
      type: String,
      enum: Object.values(RecipientStatus),
      default: RecipientStatus.PENDING,
    },
    trackingToken: { type: String },
    sentAt: { type: Date },
    openedAt: { type: Date },
    acknowledgedAt: { type: Date },
    errorMessage: { type: String },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class AdmissionLetterSend {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AdmissionLetterTemplate',
    required: true,
  })
  templateId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({ default: '' })
  bodyHtml: string;

  @Prop({ required: true })
  fromEmail: string;

  @Prop({ required: true })
  fromName: string;

  @Prop({ type: [String], default: [] })
  ccEmails: string[];

  @Prop({ default: '' })
  signOffName: string;

  @Prop({ default: '' })
  signOffTitle: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  signedOffBy: Types.ObjectId;

  @Prop()
  signedOffAt: Date;

  @Prop({ type: [RecipientSchema], default: [] })
  recipients: any[];

  @Prop({ default: 0 })
  totalRecipients: number;

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop({ default: 0 })
  openedCount: number;

  @Prop({ default: 0 })
  acknowledgedCount: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  sentBy: Types.ObjectId;
}

export const AdmissionLetterSendSchema =
  SchemaFactory.createForClass(AdmissionLetterSend);
