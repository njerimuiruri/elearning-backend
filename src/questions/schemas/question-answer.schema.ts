import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type QuestionAnswerDocument = QuestionAnswer & Document;

@Schema({ timestamps: true })
export class QuestionAnswer {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  instructorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop()
  moduleIndex: number;

  @Prop({ type: Types.ObjectId, ref: 'Lesson' })
  lessonId: Types.ObjectId;

  // Question Details
  @Prop({ required: true })
  questionTitle: string;

  @Prop({ required: true })
  questionContent: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // AI Features
  @Prop({ enum: ['general', 'technical', 'conceptual', 'assessment'], default: 'general' })
  questionCategory: string;

  @Prop({ default: 0 })
  aiConfidenceScore: number; // 0-1 scale

  @Prop()
  aiSuggestedAnswer: string;

  @Prop({ default: 0 })
  aiRelevanceScore: number; // 0-100 scale

  @Prop({ type: Map, of: Number, default: {} })
  aiMetrics: Map<string, number>;

  // Response & Conversation
  @Prop()
  instructorResponse: string;

  @Prop()
  respondedAt: Date;

  @Prop({
    enum: ['unanswered', 'pending', 'answered', 'resolved'],
    default: 'unanswered',
  })
  status: string;

  @Prop({
    type: [
      {
        senderId: { type: Types.ObjectId, ref: 'User' },
        senderType: { enum: ['student', 'instructor'] },
        message: String,
        createdAt: Date,
        aiSuggested: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  conversationThread: Array<{
    senderId: Types.ObjectId;
    senderType: 'student' | 'instructor';
    message: string;
    createdAt: Date;
    aiSuggested?: boolean;
  }>;

  // Ratings & Feedback
  @Prop({ min: 1, max: 5 })
  studentRating: number;

  @Prop()
  studentFeedback: string;

  @Prop({ min: 1, max: 5 })
  helpfulness: number;

  // Tracking
  @Prop({ default: false })
  isResolved: boolean;

  @Prop()
  resolvedAt: Date;

  @Prop({ default: false })
  isRead: boolean;

  @Prop()
  readAt: Date;

  @Prop({ default: 0 })
  views: number;

  @Prop({ type: [Types.ObjectId], default: [] })
  viewedBy: Types.ObjectId[];

  // Priority
  @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority: string;

  @Prop()
  responseTime: number; // in hours

  // Discovery
  @Prop({ type: [String], default: [] })
  relatedQuestions: string[];

  @Prop({ type: [String], default: [] })
  suggestedResources: string[];

  @Prop({ default: false })
  isFrequentlyAsked: boolean;

  @Prop({ default: 0 })
  frequencyCount: number;

  // Admin Controls
  @Prop({ default: false })
  flaggedByAdmin: boolean;

  @Prop()
  adminNotes: string;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ type: [Types.ObjectId], default: [] })
  helpfulVotes: Types.ObjectId[];

  @Prop({ default: 0 })
  helpfulCount: number;
}

export const QuestionAnswerSchema = SchemaFactory.createForClass(QuestionAnswer);

// Create indices for optimization
QuestionAnswerSchema.index({ courseId: 1, status: 1 });
QuestionAnswerSchema.index({ studentId: 1, courseId: 1 });
QuestionAnswerSchema.index({ instructorId: 1, status: 1 });
QuestionAnswerSchema.index({ createdAt: -1 });
QuestionAnswerSchema.index({ priority: 1, status: 1 });
QuestionAnswerSchema.index({ aiConfidenceScore: -1 });
QuestionAnswerSchema.index({ isResolved: 1, status: 1 });
