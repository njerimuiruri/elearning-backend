import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NoteDocument = Note & Document;

@Schema({ timestamps: true })
export class Note {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course' })
  courseId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Module' })
  moduleId?: Types.ObjectId;

  @Prop()
  courseName: string;

  @Prop()
  moduleIndex: number;

  @Prop()
  moduleName: string;

  @Prop()
  lessonIndex: number;

  @Prop()
  lessonName: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: 'personal' })
  category: string; // 'personal', 'important', 'review'

  @Prop({ default: false })
  isBookmarked: boolean;

  @Prop({ default: null })
  tags: string[];

  @Prop({ default: new Date() })
  createdAt: Date;

  @Prop({ default: new Date() })
  updatedAt: Date;
}

export const NoteSchema = SchemaFactory.createForClass(Note);

// Indices for better query performance
NoteSchema.index({ studentId: 1, courseId: 1 });
NoteSchema.index({ studentId: 1, moduleId: 1 });
NoteSchema.index({ studentId: 1, createdAt: -1 });
NoteSchema.index({ courseId: 1, createdAt: -1 });
NoteSchema.index({ studentId: 1, isBookmarked: 1 });
