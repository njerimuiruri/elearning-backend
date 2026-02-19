import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum PurchaseType {
  CATEGORY_ACCESS = 'category_access',
  COURSE_ENROLLMENT = 'course_enrollment',
}

@Schema({ timestamps: true })
export class Payment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', index: true })
  courseId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module', index: true })
  moduleId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', index: true })
  categoryId?: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING, index: true })
  status: string;

  @Prop({ required: true, unique: true })
  paystackReference: string;

  @Prop()
  paystackAccessCode?: string;

  @Prop()
  paystackAuthorizationUrl?: string;

  @Prop()
  paystackTransactionId?: number;

  @Prop({ type: String, enum: PurchaseType, required: true })
  purchaseType: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  failureReason?: string;

  @Prop()
  refundReason?: string;

  @Prop()
  refundedAt?: Date;

  // Timestamps (managed by mongoose)
  createdAt: Date;
  updatedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// Create indexes for efficient queries
PaymentSchema.index({ userId: 1, status: 1 });
PaymentSchema.index({ categoryId: 1, status: 1 });
PaymentSchema.index({ paystackReference: 1 });
PaymentSchema.index({ createdAt: -1 });
