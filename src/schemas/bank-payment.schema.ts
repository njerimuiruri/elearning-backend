import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum BankPaymentStatus {
  PAID = 'paid',
  PARTIAL = 'partial',
  PENDING = 'pending',
  PAY_LATER = 'pay_later',
}

@Schema({ timestamps: true })
export class BankPayment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId!: Types.ObjectId;

  @Prop({ required: true })
  fullName!: string;

  @Prop({ required: true })
  email!: string;

  @Prop()
  gender?: string;

  @Prop()
  nationality?: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  institution?: string;

  @Prop()
  participantCategory?: string;

  @Prop({ required: true, default: 0 })
  amountDue!: number;

  @Prop({ required: true, default: 0 })
  amountPaid!: number;

  @Prop({ required: true, default: 0 })
  balance!: number;

  @Prop({
    type: String,
    enum: BankPaymentStatus,
    default: BankPaymentStatus.PENDING,
  })
  paymentStatus!: string;

  @Prop()
  tranche?: string;

  @Prop()
  dateOfPayment?: Date;

  @Prop()
  comments?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const BankPaymentSchema = SchemaFactory.createForClass(BankPayment);

BankPaymentSchema.index({ categoryId: 1, paymentStatus: 1 });
BankPaymentSchema.index({ email: 1 });
BankPaymentSchema.index({ userId: 1 });
BankPaymentSchema.index({ createdAt: -1 });
