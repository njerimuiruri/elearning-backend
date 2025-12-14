import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Question Answer Schema - For student questions and instructor responses
 * Supports AI-powered routing, smart responses, and conversation threading
 */

@Schema({ timestamps: true })
export class QuestionAnswer extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  instructorId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Course', required: true })
  courseId: Types.ObjectId;

  @Prop({ type: Number })
  moduleIndex?: number;

  @Prop({ type: Types.ObjectId, ref: 'Lesson' })
  lessonId?: Types.ObjectId;

  // Question Details
  @Prop({ required: true })
  questionTitle: string;

  @Prop({ required: true })
  questionContent: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // AI Features
  @Prop({ type: String, enum: ['general', 'technical', 'conceptual', 'assessment'], default: 'general' })
  questionCategory: string;

  @Prop({ type: Number, min: 0, max: 1, default: 0 })
  aiConfidenceScore: number; // How confident AI is about auto-answer

  @Prop()
  aiSuggestedAnswer?: string; // AI-powered suggested answer

  @Prop({ type: Number, min: 0, max: 100, default: 0 })
  aiRelevanceScore: number; // How relevant AI suggestion is

  // Response Details
  @Prop()
  instructorResponse?: string;

  @Prop({ type: Date })
  respondedAt?: Date;

  @Prop({ default: 'unanswered' })
  status: string; // unanswered, pending, answered, resolved

  // Follow-up Conversation
  @Prop({ type: [{ 
    senderId: Types.ObjectId,
    senderType: String, // 'student' or 'instructor'
    message: String,
    createdAt: Date,
    aiSuggested: Boolean
  }], default: [] })
  conversationThread: any[];

  // Ratings & Feedback
  @Prop({ type: Number, min: 1, max: 5 })
  studentRating?: number; // Student satisfaction rating

  @Prop()
  studentFeedback?: string;

  @Prop({ type: Number, min: 1, max: 5 })
  helpfulness?: number; // How helpful was the response

  // Tracking
  @Prop({ default: false })
  isResolved: boolean;

  @Prop({ type: Date })
  resolvedAt?: Date;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ type: Date })
  readAt?: Date;

  @Prop({ type: [Types.ObjectId], default: [] })
  viewedBy: Types.ObjectId[];

  @Prop({ default: 0 })
  views: number;

  // Priority & Urgency
  @Prop({ type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority: string;

  @Prop({ type: Number, default: 0 })
  responseTime: number; // Time taken by instructor to respond (in hours)

  // AI-Powered Insights
  @Prop({ type: [String], default: [] })
  relatedQuestions: string[]; // IDs of similar questions

  @Prop({ type: [String], default: [] })
  suggestedResources: string[]; // URLs to helpful resources

  @Prop({ default: false })
  isFrequentlyAsked: boolean; // Marked by admin if commonly asked

  @Prop()
  frequencyCount?: number; // How many times this type of question has been asked

  @Prop({ type: Map, of: Number, default: {} })
  aiMetrics: Map<string, number>; // Additional AI metrics

  // Admin Tracking
  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop({ default: false })
  flaggedByAdmin: boolean;

  @Prop()
  adminNotes?: string;

  @Prop({ default: false })
  isPublic: boolean; // Can other students see this Q&A

  @Prop({ type: [Types.ObjectId], default: [] })
  helpfulVotes: Types.ObjectId[]; // Students who found this helpful

  @Prop({ default: 0 })
  helpfulCount: number;
}

export const QuestionAnswerSchema = SchemaFactory.createForClass(QuestionAnswer);

// Indexes for better query performance
QuestionAnswerSchema.index({ courseId: 1, status: 1 });
QuestionAnswerSchema.index({ studentId: 1, courseId: 1 });
QuestionAnswerSchema.index({ instructorId: 1, status: 1 });
QuestionAnswerSchema.index({ createdAt: -1 });
QuestionAnswerSchema.index({ priority: 1, createdAt: -1 });
QuestionAnswerSchema.index({ aiConfidenceScore: -1 });
QuestionAnswerSchema.index({ isResolved: 1, status: 1 });
