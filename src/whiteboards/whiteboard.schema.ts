import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as mongoose from 'mongoose';

export type WhiteboardDocument = Whiteboard & Document;

@Schema({ timestamps: true })
export class Whiteboard {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  instructorId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  // Each element is one page's array of drawing paths
  @Prop({ type: [[mongoose.Schema.Types.Mixed]], default: [[]] })
  pages: any[][];

  // Text elements per page: [[{ id, x, y, text, color, fontSize }], ...]
  @Prop({ type: [[mongoose.Schema.Types.Mixed]], default: [[]] })
  textLayers: any[][];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Category' }], default: [] })
  sharedWith: Types.ObjectId[];

  @Prop({ default: false })
  isShared: boolean;
}

export const WhiteboardSchema = SchemaFactory.createForClass(Whiteboard);

WhiteboardSchema.index({ instructorId: 1, createdAt: -1 });
WhiteboardSchema.index({ sharedWith: 1, isShared: 1 });
