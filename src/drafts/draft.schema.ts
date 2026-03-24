import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

export type DraftDocument = Draft & Document;

@Schema({ timestamps: true })
export class Draft {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  draftKey!: string;

  @Prop({ required: true, default: 'module' })
  contentType!: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  data: any;

  @Prop()
  entityId?: string;

  @Prop()
  title?: string;

  @Prop({ type: Date, default: Date.now })
  lastSavedAt!: Date;
}

export const DraftSchema = SchemaFactory.createForClass(Draft);

// One draft per user per draftKey
DraftSchema.index({ userId: 1, draftKey: 1 }, { unique: true });
