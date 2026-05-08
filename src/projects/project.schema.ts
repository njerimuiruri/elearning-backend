import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProjectDocument = Project & Document;

@Schema({ timestamps: true })
export class Project {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  declare studentId: Types.ObjectId;

  @Prop({ required: true })
  declare studentName: string;

  @Prop({ required: true })
  declare title: string;

  @Prop({ default: '' })
  declare description: string;

  @Prop({ type: [String], default: [] })
  declare tags: string[];

  @Prop({ required: true })
  declare fileName: string;

  @Prop({ required: true })
  declare fileUrl: string;

  @Prop({ default: 'pending', enum: ['pending', 'approved', 'rejected'] })
  declare status: string;

  @Prop({ default: '' })
  declare adminFeedback: string;

  // true when an admin uploaded this resource (auto-approved)
  @Prop({ default: false })
  declare uploadedByAdmin: boolean;

  // credited author name (used for admin-uploaded resources)
  @Prop({ default: '' })
  declare authorName: string;

  // credited author email
  @Prop({ default: '' })
  declare authorEmail: string;

  // null = visible to all fellows; email string = only that fellow
  @Prop({ default: null, type: String })
  declare targetEmail: string | null;

  @Prop({
    type: [{ userId: { type: Types.ObjectId, ref: 'User' }, value: Number }],
    default: [],
  })
  declare ratings: { userId: Types.ObjectId; value: number }[];
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

ProjectSchema.index({ studentId: 1, createdAt: -1 });
ProjectSchema.index({ status: 1, createdAt: -1 });
ProjectSchema.index({ uploadedByAdmin: 1, targetEmail: 1 });
