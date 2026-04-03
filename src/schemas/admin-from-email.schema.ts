import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AdminFromEmailDocument = AdminFromEmail & Document;

@Schema({ timestamps: true })
export class AdminFromEmail {
  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true, trim: true })
  displayName: string;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  addedBy: Types.ObjectId;
}

export const AdminFromEmailSchema =
  SchemaFactory.createForClass(AdminFromEmail);
