import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

class Reply {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true })
  authorName: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: 0 })
  likes: number;

  @Prop({ default: null })
  createdAt?: Date;
}

@Schema({ timestamps: true })
export class Discussion extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  instructorId: Types.ObjectId;

  @Prop({ required: true })
  moduleIndex: number;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [Reply], default: [] })
  replies: Reply[];

  @Prop({ default: false })
  isResolved: boolean;

  @Prop({ default: 0 })
  views: number;

  @Prop({ default: 0 })
  likes: number;

  @Prop({ default: 'open', enum: ['open', 'resolved', 'closed'] })
  status: string;

  createdAt: Date;
  updatedAt: Date;
}

export const DiscussionSchema = SchemaFactory.createForClass(Discussion);

// Create indexes
DiscussionSchema.index({ courseId: 1 });
DiscussionSchema.index({ studentId: 1 });
DiscussionSchema.index({ instructorId: 1 });
DiscussionSchema.index({ status: 1 });
DiscussionSchema.index({ createdAt: -1 });
