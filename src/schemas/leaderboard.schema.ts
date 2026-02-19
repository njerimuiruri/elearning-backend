import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum LeaderboardPeriod {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  ALL_TIME = 'all_time',
}

export class RankingEntry {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ required: true })
  studentName: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ required: true })
  totalXP: number;

  @Prop({ required: true })
  completedModules: number;

  @Prop({ required: true })
  averageScore: number;

  @Prop({ required: true })
  rank: number;
}

@Schema({ timestamps: true })
export class Leaderboard extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ enum: ['beginner', 'intermediate', 'advanced'] })
  level?: string; // Optional: leaderboard per level

  @Prop({ enum: LeaderboardPeriod, required: true })
  period: LeaderboardPeriod;

  @Prop({ type: [RankingEntry], default: [] })
  rankings: RankingEntry[];

  @Prop()
  periodStartDate?: Date;

  @Prop()
  periodEndDate?: Date;

  @Prop({ required: true })
  updatedAt: Date;

  createdAt: Date;
}

export const LeaderboardSchema = SchemaFactory.createForClass(Leaderboard);

// Indexes
LeaderboardSchema.index({ categoryId: 1, level: 1, period: 1 }, { unique: true });
LeaderboardSchema.index({ updatedAt: -1 });
