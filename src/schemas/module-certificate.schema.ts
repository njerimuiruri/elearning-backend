import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class ModuleCertificate extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module', required: true })
  moduleId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ModuleEnrollment', required: true })
  enrollmentId: Types.ObjectId;

  @Prop({ required: true })
  studentName: string;

  @Prop({ required: true })
  moduleName: string;

  @Prop({ required: true })
  moduleLevel: string; // beginner, intermediate, advanced

  @Prop({ required: true })
  categoryName: string;

  @Prop({ required: true })
  scoreAchieved: number;

  @Prop({ required: true })
  instructorName: string;

  @Prop({ required: true })
  issuedDate: Date;

  @Prop({ required: true, unique: true })
  certificateNumber: string;

  @Prop({ required: true, unique: true })
  publicId: string; // For public verification

  @Prop()
  pdfUrl?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const ModuleCertificateSchema = SchemaFactory.createForClass(ModuleCertificate);

// Indexes
ModuleCertificateSchema.index({ studentId: 1 });
ModuleCertificateSchema.index({ moduleId: 1 });
ModuleCertificateSchema.index({ publicId: 1 }, { unique: true });
ModuleCertificateSchema.index({ certificateNumber: 1 }, { unique: true });
