import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum AccessType {
  FREE = 'free',
  PAID = 'paid',
  RESTRICTED = 'restricted', // e.g. Fellows only
}

@Schema({ timestamps: true })
export class Category extends Document {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: String, enum: AccessType, default: AccessType.FREE })
  accessType: string;

  @Prop({ default: false })
  isPaid: boolean; // If true, payment is required for non-eligible users

  @Prop({ type: [String], default: [] })
  allowedRoles: string[]; // Roles that get free access (e.g. ['fellow'])

  @Prop({ default: 0 })
  price: number; // Cost for users who don't have free access

  @Prop({ default: true })
  paymentRequiredForNonEligible: boolean; // If true, non-fellows can pay to access.

  @Prop({ trim: true })
  courseDescription?: string; // Rich text (HTML)

  @Prop({ trim: true })
  overallObjectives?: string; // Rich text (HTML)

  @Prop({ trim: true })
  learningOutcomes?: string; // Rich text (HTML)

  @Prop({ trim: true })
  academicStructure?: string; // Rich text (HTML)

  @Prop({ trim: true })
  progressionFramework?: string; // Rich text (HTML)

  @Prop({ trim: true })
  fellowshipLevels?: string; // Rich text (HTML)
}

export const CategorySchema = SchemaFactory.createForClass(Category);
