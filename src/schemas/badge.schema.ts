import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum BadgeType {
  LEVEL_COMPLETION = 'level_completion',
  PERFECT_SCORE = 'perfect_score',
  SPEED_LEARNER = 'speed_learner',
  STREAK_MASTER = 'streak_master',
  CATEGORY_MASTER = 'category_master',
  FIRST_MODULE = 'first_module',
  FIRST_CERTIFICATE = 'first_certificate',
}

@Schema({ timestamps: true })
export class Badge extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ enum: BadgeType, required: true })
  badgeType: BadgeType;

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  categoryId?: Types.ObjectId;

  @Prop({ enum: ['beginner', 'intermediate', 'advanced'] })
  level?: string;

  @Prop({ type: Types.ObjectId, ref: 'Module' })
  moduleId?: Types.ObjectId;

  @Prop({ required: true })
  earnedAt: Date;

  @Prop({ type: Object })
  metadata?: {
    streakDays?: number;
    scoreAchieved?: number;
    completionTime?: number;
    [key: string]: any;
  };

  @Prop({ required: true })
  icon: string; // Icon name or URL

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  createdAt: Date;
  updatedAt: Date;
}

export const BadgeSchema = SchemaFactory.createForClass(Badge);

// Indexes
BadgeSchema.index({ studentId: 1 });
BadgeSchema.index({ badgeType: 1 });
BadgeSchema.index({ studentId: 1, badgeType: 1, categoryId: 1, level: 1 }, { unique: true, sparse: true });
BadgeSchema.index({ earnedAt: -1 });
