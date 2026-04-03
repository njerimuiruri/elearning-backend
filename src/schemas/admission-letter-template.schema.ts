import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AdmissionLetterTemplateDocument = AdmissionLetterTemplate &
  Document;

@Schema({ timestamps: true })
export class AdmissionLetterTemplate {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  pdfUrl: string;

  @Prop({ required: true })
  pdfPublicId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  uploadedBy: Types.ObjectId;
}

export const AdmissionLetterTemplateSchema = SchemaFactory.createForClass(
  AdmissionLetterTemplate,
);
