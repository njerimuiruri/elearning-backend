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
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course' })
  courseId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module' })
  moduleId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  categoryId?: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop({
    type: String,
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status!: string;

  @Prop({ required: true, unique: true })
  paystackReference!: string;

  @Prop()
  paystackAccessCode?: string;

  @Prop()
  paystackAuthorizationUrl?: string;

  @Prop()
  paystackTransactionId?: number;

  @Prop({ type: String, enum: PurchaseType, required: true })
  purchaseType!: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  failureReason?: string;

  // Tiered pricing — track whether student or non-student price was used
  @Prop({ default: false })
  isStudentPrice?: boolean;

  @Prop({ type: String, enum: ['student', 'non-student'], default: null })
  userTier?: string;

  @Prop()
  refundReason?: string;

  @Prop()
  refundedAt?: Date;

  // Installment tracking
  @Prop({ default: false })
  isInstallment?: boolean;

  @Prop({ type: Number, enum: [1, 2], default: null })
  installmentNumber?: number;

  @Prop({ default: false })
  isFullPayment?: boolean;

  // Timestamps (managed by mongoose)
  createdAt!: Date;
  updatedAt!: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// Create indexes for efficient queries
PaymentSchema.index({ userId: 1, status: 1 });
PaymentSchema.index({ categoryId: 1, status: 1 });
PaymentSchema.index({ paystackReference: 1 });
PaymentSchema.index({ createdAt: -1 });
