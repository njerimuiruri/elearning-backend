import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CapstoneDocument = Capstone & Document;

export const CAPSTONE_STATUSES = [
  'submitted',
  'under_review',
  'revision_requested',
  'approved',
  'implementation',
  'implementation_submitted',
  'grading',
  'graded',
  'completed',
  'rejected',
] as const;

export type CapstoneStatus = (typeof CAPSTONE_STATUSES)[number];

const MAX_REVISIONS = 2;

@Schema({ timestamps: true })
export class Capstone {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ required: true })
  studentName: string;

  @Prop({ required: true })
  studentEmail: string;

  // ── Proposal fields ──────────────────────────────────────────────────────

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  description: string; // HTML from Quill rich-text editor

  @Prop({
    type: [{ fileName: { type: String }, fileUrl: { type: String } }],
    default: [],
  })
  files: { fileName: string; fileUrl: string }[];

  // ── Status & revision tracking ───────────────────────────────────────────

  @Prop({
    type: String,
    enum: CAPSTONE_STATUSES,
    default: 'submitted',
  })
  status: CapstoneStatus;

  @Prop({ default: 0, min: 0, max: MAX_REVISIONS })
  revisionCount: number;

  @Prop({ default: '' })
  instructorComment: string; // Most recent feedback from instructor

  // ── Implementation fields ────────────────────────────────────────────────

  @Prop({
    type: [{ fileName: { type: String }, fileUrl: { type: String } }],
    default: [],
  })
  implementationFiles: { fileName: string; fileUrl: string }[];

  @Prop({ default: '' })
  implementationNotes: string; // HTML notes from student

  // ── Grading ──────────────────────────────────────────────────────────────

  @Prop({ type: Number, default: null })
  grade: number | null;

  @Prop({ default: '' })
  gradeFeedback: string;

  @Prop({ type: Boolean, default: null })
  passed: boolean | null;

  // ── Comment history ──────────────────────────────────────────────────────

  @Prop({
    type: [
      {
        from: { type: String },
        message: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  comments: { from: string; message: string; createdAt: Date }[];

  // ── Timestamps ───────────────────────────────────────────────────────────

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: Date, default: null })
  implementationSubmittedAt: Date | null;

  @Prop({ type: Date, default: null })
  gradedAt: Date | null;
}

export const CapstoneSchema = SchemaFactory.createForClass(Capstone);

CapstoneSchema.index({ studentId: 1, createdAt: -1 });
CapstoneSchema.index({ status: 1, updatedAt: -1 });
CapstoneSchema.index({ studentEmail: 1 });
