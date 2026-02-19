import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Track completion per level
export class LevelProgress {
  @Prop({ required: true, enum: ['beginner', 'intermediate', 'advanced'] })
  level: string;

  @Prop({ default: 0 })
  totalModules: number; // Total modules in this level (for this category)

  @Prop({ default: 0 })
  completedModules: number;

  @Prop({ default: false })
  isUnlocked: boolean;

  @Prop({ default: false })
  isCompleted: boolean;

  @Prop()
  unlockedAt?: Date;

  @Prop()
  completedAt?: Date;
}

@Schema({ timestamps: true })
export class StudentProgression extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  // Current level (beginner, intermediate, advanced)
  @Prop({
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner'
  })
  currentLevel: string;

  // Track progress per level
  @Prop({ type: [LevelProgress], default: [] })
  levelProgress: LevelProgress[];

  // Overall category progress
  @Prop({ default: 0 })
  totalModulesCompleted: number;

  @Prop({ default: 0 })
  totalModulesInCategory: number;

  @Prop({ default: 0 })
  overallProgress: number; // Percentage

  // Completed module IDs (for quick lookup)
  @Prop({ type: [Types.ObjectId], ref: 'Module', default: [] })
  completedModuleIds: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

export const StudentProgressionSchema = SchemaFactory.createForClass(StudentProgression);

// Indexes
StudentProgressionSchema.index({ studentId: 1, categoryId: 1 }, { unique: true });
StudentProgressionSchema.index({ studentId: 1 });
StudentProgressionSchema.index({ categoryId: 1 });
