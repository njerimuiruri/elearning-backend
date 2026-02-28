import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class ModuleRating extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module', required: true })
  moduleId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number; // 1–5 stars

  @Prop({ trim: true, maxlength: 1000 })
  review?: string; // Optional text review

  createdAt: Date;
  updatedAt: Date;
}

export const ModuleRatingSchema = SchemaFactory.createForClass(ModuleRating);

// One rating per student per module (upsert allowed for edits)
ModuleRatingSchema.index({ studentId: 1, moduleId: 1 }, { unique: true });
ModuleRatingSchema.index({ moduleId: 1 });
ModuleRatingSchema.index({ moduleId: 1, rating: 1 });
