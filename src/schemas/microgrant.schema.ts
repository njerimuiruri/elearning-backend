import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum MicrograntStatus {
  PENDING   = 'pending',
  APPROVED  = 'approved',
  ISSUED    = 'issued',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true })
export class Microgrant extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  /** Financial amount in KES */
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ default: 'KES' })
  currency: string;

  @Prop({ enum: MicrograntStatus, default: MicrograntStatus.PENDING })
  status: MicrograntStatus;

  /** Snapshot of scores used to determine eligibility */
  @Prop({ type: Object, default: {} })
  criteriaSnapshot: {
    assessmentScore: number;   // 0–100 average
    engagementScore: number;   // 0–100
    activityScore: number;     // 0–100
    compositeScore: number;    // 0–100 weighted
    completedModules: number;
    totalModules: number;
    daysSinceLastLogin: number;
  };

  @Prop({ type: Types.ObjectId, ref: 'User' })
  issuedBy?: Types.ObjectId;

  @Prop({ default: null })
  issuedAt?: Date;

  @Prop()
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const MicrograntSchema = SchemaFactory.createForClass(Microgrant);

MicrograntSchema.index({ studentId: 1, categoryId: 1 });
MicrograntSchema.index({ status: 1 });
MicrograntSchema.index({ createdAt: -1 });
