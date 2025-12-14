import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as crypto from 'crypto';

@Schema({ timestamps: true })
export class Certificate extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Enrollment', required: true })
  enrollmentId: Types.ObjectId;

  @Prop({ required: true })
  certificateNumber: string;

  @Prop({ type: String, unique: true, default: () => crypto.randomUUID() })
  publicId: string; // UUID for public URLs

  @Prop({ required: true })
  issuedDate: Date;

  @Prop({ required: true })
  studentName: string;

  @Prop({ required: true })
  courseName: string;

  @Prop({ required: true })
  scoreAchieved: number;

  @Prop({ required: true })
  instructorName: string;

  @Prop()
  certificateUrl?: string;

  @Prop({ default: true })
  isValid: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const CertificateSchema = SchemaFactory.createForClass(Certificate);

// Create indexes
CertificateSchema.index({ studentId: 1 });
CertificateSchema.index({ courseId: 1 });
CertificateSchema.index({ certificateNumber: 1 }, { unique: true });
CertificateSchema.index({ publicId: 1 }, { unique: true });
CertificateSchema.index({ issuedDate: -1 });
