import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QuestionAnswer } from '../schemas/question-answer.schema';
import { Enrollment } from '../schemas/enrollment.schema';
import { User } from '../schemas/user.schema';
import { Course } from '../schemas/course.schema';

/**
 * AI-Powered Q&A Service
 * Handles intelligent question routing, AI-powered suggestions, and conversation management
 */
@Injectable()
export class QuestionAnswerService {
  constructor(
    @InjectModel(QuestionAnswer.name) private qaModel: Model<QuestionAnswer>,
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
  ) {}

  /**
   * Create a new question from student
   * Includes AI categorization and suggested answers
   */
  async createQuestion(
    studentId: string,
    courseId: string,
    questionData: {
      title: string;
      content: string;
      moduleIndex?: number;
      lessonId?: string;
      priority?: string;
      tags?: string[];
    },
  ) {
    try {
      // Verify student is enrolled
      const enrollment = await this.enrollmentModel.findOne({
        studentId,
        courseId,
      });

      if (!enrollment) {
        throw new Error('Student not enrolled in this course');
      }

      // AI-powered categorization
      const category = this.categorizeQuestion(questionData.content);
      const aiSuggestion = await this.generateAISuggestedAnswer(
        questionData.content,
        courseId,
        category,
      );

      // Find appropriate instructor (least loaded)
      const instructor = await this.findAvailableInstructor(courseId);

      const question = await this.qaModel.create({
        studentId,
        courseId,
        instructorId: instructor?._id,
        questionTitle: questionData.title,
        questionContent: questionData.content,
        moduleIndex: questionData.moduleIndex,
        lessonId: questionData.lessonId,
        priority: questionData.priority || this.calculatePriority(questionData.content),
        tags: questionData.tags || [],
        questionCategory: category,
        aiSuggestedAnswer: aiSuggestion.answer,
        aiConfidenceScore: aiSuggestion.confidence,
        aiRelevanceScore: aiSuggestion.relevance,
        status: aiSuggestion.confidence > 0.85 ? 'pending' : 'unanswered',
        conversationThread: [],
        views: 0,
      });

      return {
        success: true,
        question: question.toObject(),
        aiSuggestion: {
          answer: aiSuggestion.answer,
          confidence: aiSuggestion.confidence,
          relevance: aiSuggestion.relevance,
          category,
        },
      };
    } catch (error) {
      console.error('Error creating question:', error);
      throw error;
    }
  }

  /**
   * AI categorization of question based on content
   */
  private categorizeQuestion(content: string): string {
    const lowerContent = content.toLowerCase();

    if (
      lowerContent.includes('error') ||
      lowerContent.includes('bug') ||
      lowerContent.includes('crash') ||
      lowerContent.includes('not working')
    ) {
      return 'technical';
    }

    if (
      lowerContent.includes('understand') ||
      lowerContent.includes('explain') ||
      lowerContent.includes('how does') ||
      lowerContent.includes('why')
    ) {
      return 'conceptual';
    }

    if (
      lowerContent.includes('assignment') ||
      lowerContent.includes('quiz') ||
      lowerContent.includes('exam') ||
      lowerContent.includes('grade')
    ) {
      return 'assessment';
    }

    return 'general';
  }

  /**
   * Generate AI-powered suggested answer
   */
  private async generateAISuggestedAnswer(
    questionContent: string,
    courseId: string,
    category: string,
  ): Promise<{ answer: string; confidence: number; relevance: number }> {
    // This would integrate with OpenAI or similar
    // For now, providing template-based answers
    
    const commonAnswers = {
      technical: 'Please try clearing your browser cache and reloading the page. If the issue persists, check your internet connection or try a different browser.',
      conceptual: 'I recommend reviewing the lesson materials and related resources. Pay special attention to the key concepts highlighted in the module.',
      assessment: 'For questions about grades or assignments, please check the rubric and grading criteria provided with the assignment.',
      general: 'Thank you for your question. Our instructor will review this and provide a detailed response soon.',
    };

    return {
      answer: commonAnswers[category] || commonAnswers.general,
      confidence: 0.65, // Medium confidence - needs instructor verification
      relevance: 0.72,
    };
  }

  /**
   * Find least loaded available instructor for a course
   */
  private async findAvailableInstructor(courseId: string): Promise<any> {
    const course = await this.courseModel
      .findById(courseId)
      .populate('instructorIds');

    // Return the first instructor if available
    return Array.isArray(course?.instructorIds) && course.instructorIds.length > 0 ? course.instructorIds[0] : null;
  }

  /**
   * Calculate priority based on content urgency markers
   */
  private calculatePriority(content: string): string {
    const lowerContent = content.toLowerCase();
    
    if (
      lowerContent.includes('urgent') ||
      lowerContent.includes('asap') ||
      lowerContent.includes('emergency') ||
      lowerContent.includes('immediately')
    ) {
      return 'urgent';
    }

    if (
      lowerContent.includes('important') ||
      lowerContent.includes('critical')
    ) {
      return 'high';
    }

    if (lowerContent.includes('minor') || lowerContent.includes('small')) {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Add instructor response with email notification
   */
  async respondToQuestion(
    questionId: string,
    instructorId: string,
    response: string,
    suggestPublic: boolean = false,
  ) {
    try {
      const question = await this.qaModel.findById(questionId);

      if (!question) {
        throw new Error('Question not found');
      }

      // Verify instructor owns this course or is assigned
      const course = await this.courseModel.findById(question.courseId);
      const instructorIds = Array.isArray(course?.instructorIds) ? course.instructorIds.map((id: any) => id.toString()) : [];
      if (course && !instructorIds.includes(instructorId) && question.instructorId?.toString() !== instructorId) {
        throw new Error('Not authorized to respond to this question');
      }

      // Add to conversation thread
      question.conversationThread.push({
        senderId: new Types.ObjectId(instructorId),
        senderType: 'instructor',
        message: response,
        createdAt: new Date(),
        aiSuggested: false,
      });

      // Update question
      question.instructorResponse = response;
      question.respondedAt = new Date();
      question.status = 'answered';
      question.responseTime = this.calculateResponseTime(
        question.readAt as Date,
        new Date(),
      );
      question.isPublic = suggestPublic;

      await question.save();

      // Get student info for email
      const student = await this.userModel.findById(question.studentId);

      return {
        success: true,
        question: question.toObject(),
        emailData: {
          studentEmail: student?.email,
          studentName: student?.firstName,
          questionTitle: question.questionTitle,
          response: response,
        },
      };
    } catch (error) {
      console.error('Error responding to question:', error);
      throw error;
    }
  }

  /**
   * Calculate response time in hours
   */
  private calculateResponseTime(createdAt: Date, respondedAt: Date): number {
    return Math.round(
      (respondedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60),
    );
  }

  /**
   * Student adds follow-up message to conversation
   */
  async addFollowUpMessage(
    questionId: string,
    studentId: string,
    message: string,
  ) {
    try {
      const question = await this.qaModel.findById(questionId);

      if (!question) {
        throw new Error('Question not found');
      }

      if (question.studentId.toString() !== studentId) {
        throw new Error('Not authorized to add follow-up');
      }

      // Add message to thread
      question.conversationThread.push({
        senderId: new Types.ObjectId(studentId),
        senderType: 'student',
        message,
        createdAt: new Date(),
        aiSuggested: false,
      });

      // Mark as unresolved if it was resolved
      if (question.isResolved) {
        question.isResolved = false;
        question.status = 'answered';
      } else {
        question.status = 'pending';
      }

      await question.save();

      return {
        success: true,
        question: question.toObject(),
      };
    } catch (error) {
      console.error('Error adding follow-up:', error);
      throw error;
    }
  }

  /**
   * Get all questions for a student
   */
  async getStudentQuestions(
    studentId: string,
    courseId?: string,
    status?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    try {
      const query: any = { studentId };

      if (courseId) query.courseId = courseId;
      if (status) query.status = status;

      const skip = (page - 1) * limit;

      const [questions, total] = await Promise.all([
        this.qaModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('instructorId', 'firstName lastName email')
          .populate('courseId', 'title'),
        this.qaModel.countDocuments(query),
      ]);

      return {
        questions,
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: page,
        },
      };
    } catch (error) {
      console.error('Error fetching student questions:', error);
      throw error;
    }
  }

  /**
   * Get all questions for an instructor
   */
  async getInstructorQuestions(
    instructorId: string,
    courseId?: string,
    status?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    try {
      const query: any = { instructorId };

      if (courseId) query.courseId = courseId;
      if (status) query.status = status;

      const skip = (page - 1) * limit;

      const [questions, total, stats] = await Promise.all([
        this.qaModel
          .find(query)
          .sort({ priority: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('studentId', 'firstName lastName email')
          .populate('courseId', 'title'),
        this.qaModel.countDocuments(query),
        this.getInstructorStats(instructorId),
      ]);

      return {
        questions,
        stats,
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: page,
        },
      };
    } catch (error) {
      console.error('Error fetching instructor questions:', error);
      throw error;
    }
  }

  /**
   * Get instructor statistics
   */
  private async getInstructorStats(instructorId: string) {
    const stats = await this.qaModel.aggregate([
      { $match: { instructorId: new Types.ObjectId(instructorId) } },
      {
        $facet: {
          unanswered: [
            { $match: { status: 'unanswered' } },
            { $count: 'count' },
          ],
          pending: [
            { $match: { status: 'pending' } },
            { $count: 'count' },
          ],
          answered: [
            { $match: { status: 'answered' } },
            { $count: 'count' },
          ],
          resolved: [
            { $match: { status: 'resolved' } },
            { $count: 'count' },
          ],
          avgResponseTime: [
            { $match: { respondedAt: { $exists: true } } },
            { $group: { _id: null, avg: { $avg: '$responseTime' } } },
          ],
          avgRating: [
            { $match: { studentRating: { $exists: true } } },
            { $group: { _id: null, avg: { $avg: '$studentRating' } } },
          ],
        },
      },
    ]);

    return {
      unanswered: stats[0].unanswered[0]?.count || 0,
      pending: stats[0].pending[0]?.count || 0,
      answered: stats[0].answered[0]?.count || 0,
      resolved: stats[0].resolved[0]?.count || 0,
      avgResponseTime: Math.round(stats[0].avgResponseTime[0]?.avg || 0),
      avgRating: (stats[0].avgRating[0]?.avg || 0).toFixed(2),
    };
  }

  /**
   * Get admin dashboard data
   */
  async getAdminDashboardData(courseId?: string, page: number = 1, limit: number = 10) {
    try {
      const query: any = {};
      if (courseId) query.courseId = courseId;

      const skip = (page - 1) * limit;

      const [allQuestions, totalQuestions, stats, recentActivity] = await Promise.all([
        this.qaModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('studentId', 'firstName lastName email')
          .populate('instructorId', 'firstName lastName email')
          .populate('courseId', 'title'),
        this.qaModel.countDocuments(query),
        this.getSystemStats(courseId),
        this.getRecentActivity(courseId, 50),
      ]);

      return {
        questions: allQuestions,
        stats,
        recentActivity,
        pagination: {
          total: totalQuestions,
          pages: Math.ceil(totalQuestions / limit),
          currentPage: page,
        },
      };
    } catch (error) {
      console.error('Error fetching admin dashboard:', error);
      throw error;
    }
  }

  /**
   * Get system-wide statistics
   */
  private async getSystemStats(courseId?: string) {
    const query: any = {};
    if (courseId) query.courseId = courseId;

    const stats = await this.qaModel.aggregate([
      { $match: query },
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ],
          byCategory: [
            { $group: { _id: '$questionCategory', count: { $sum: 1 } } },
          ],
          byPriority: [
            { $group: { _id: '$priority', count: { $sum: 1 } } },
          ],
          avgResponseTime: [
            { $match: { respondedAt: { $exists: true } } },
            { $group: { _id: null, avg: { $avg: '$responseTime' } } },
          ],
          highestRated: [
            { $match: { studentRating: { $exists: true } } },
            { $sort: { studentRating: -1 } },
            { $limit: 5 },
          ],
        },
      },
    ]);

    return {
      total: stats[0].total[0]?.count || 0,
      byStatus: stats[0].byStatus,
      byCategory: stats[0].byCategory,
      byPriority: stats[0].byPriority,
      avgResponseTime: Math.round(stats[0].avgResponseTime[0]?.avg || 0),
      highestRated: stats[0].highestRated || [],
    };
  }

  /**
   * Get recent activity for all conversations
   */
  private async getRecentActivity(courseId?: string, limit: number = 50) {
    const query: any = {};
    if (courseId) query.courseId = courseId;

    // Get recent Q&A activities
    const recentQA = await this.qaModel
      .find(query)
      .sort({ respondedAt: -1, createdAt: -1 })
      .limit(limit)
      .populate('studentId', 'firstName lastName')
      .populate('instructorId', 'firstName lastName');

    return recentQA.map((q) => ({
      type: q.respondedAt ? 'response' : 'question',
      timestamp: q.respondedAt || q.readAt,
      student: q.studentId,
      instructor: q.instructorId,
      course: q.courseId,
      title: q.questionTitle,
      questionId: q._id,
      status: q.status,
    }));
  }

  /**
   * Mark question as resolved
   */
  async markAsResolved(questionId: string, resolvedBy: string) {
    try {
      const question = await this.qaModel.findByIdAndUpdate(
        questionId,
        {
          isResolved: true,
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy,
        },
        { new: true },
      );

      return { success: true, question };
    } catch (error) {
      console.error('Error resolving question:', error);
      throw error;
    }
  }

  /**
   * Rate instructor response
   */
  async rateResponse(
    questionId: string,
    studentId: string,
    rating: number,
    feedback?: string,
  ) {
    try {
      const question = await this.qaModel.findById(questionId);

      if (!question || question.studentId.toString() !== studentId) {
        throw new Error('Not authorized');
      }

      question.studentRating = rating;
      question.studentFeedback = feedback;
      question.helpfulness = rating;

      await question.save();

      return { success: true, question };
    } catch (error) {
      console.error('Error rating response:', error);
      throw error;
    }
  }

  /**
   * Search questions by keywords or filters
   */
  async searchQuestions(
    courseId: string,
    searchTerm?: string,
    filters?: {
      status?: string;
      category?: string;
      priority?: string;
      isResolved?: boolean;
    },
    page: number = 1,
    limit: number = 10,
  ) {
    try {
      const query: any = { courseId };

      if (searchTerm) {
        query.$or = [
          { questionTitle: { $regex: searchTerm, $options: 'i' } },
          { questionContent: { $regex: searchTerm, $options: 'i' } },
          { tags: { $in: [searchTerm] } },
        ];
      }

      if (filters?.status) query.status = filters.status;
      if (filters?.category) query.questionCategory = filters.category;
      if (filters?.priority) query.priority = filters.priority;
      if (filters?.isResolved !== undefined) query.isResolved = filters.isResolved;

      const skip = (page - 1) * limit;

      const [questions, total] = await Promise.all([
        this.qaModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('studentId', 'firstName lastName')
          .populate('instructorId', 'firstName lastName'),
        this.qaModel.countDocuments(query),
      ]);

      return {
        questions,
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: page,
        },
      };
    } catch (error) {
      console.error('Error searching questions:', error);
      throw error;
    }
  }

  /**
   * Get similar questions using AI
   */
  async getSimilarQuestions(questionId: string) {
    try {
      const question = await this.qaModel.findById(questionId);

      if (!question) {
        throw new Error('Question not found');
      }

      // Simple keyword-based similarity (can be enhanced with real ML)
      const similarQuestions = await this.qaModel
        .find({
          courseId: question.courseId,
          questionCategory: question.questionCategory,
          _id: { $ne: questionId },
          tags: { $in: question.tags },
        })
        .limit(5);

      return {
        questions: similarQuestions,
        relatedResourcesLink: `/courses/${question.courseId}/resources?tags=${question.tags.join(',')}`,
      };
    } catch (error) {
      console.error('Error finding similar questions:', error);
      throw error;
    }
  }

  /**
   * Flag question for admin review
   */
  async flagQuestion(questionId: string, reason: string, notes?: string) {
    try {
      const question = await this.qaModel.findByIdAndUpdate(
        questionId,
        {
          flaggedByAdmin: true,
          adminNotes: notes,
        },
        { new: true },
      );

      return {
        success: true,
        question,
        notificationData: {
          type: 'question_flagged',
          questionId,
          reason,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      console.error('Error flagging question:', error);
      throw error;
    }
  }

  /**
   * Mark helpful/unhelpful for community
   */
  async markHelpful(questionId: string, userId: string, isHelpful: boolean) {
    try {
      const question = await this.qaModel.findById(questionId);
      if (!question) {
        throw new NotFoundException('Question not found');
      }

      const userObjectId = new Types.ObjectId(userId);
      const hasVoted = question.helpfulVotes.some((id) =>
        id.equals(userObjectId),
      );

      if (isHelpful && !hasVoted) {
        question.helpfulVotes.push(userObjectId);
        question.helpfulCount = (question.helpfulCount || 0) + 1;
      } else if (!isHelpful && hasVoted) {
        question.helpfulVotes = question.helpfulVotes.filter(
          (id) => !id.equals(userObjectId),
        );
        question.helpfulCount = Math.max(0, (question.helpfulCount || 1) - 1);
      }

      await question.save();

      return { success: true, helpfulCount: question.helpfulCount };
    } catch (error) {
      console.error('Error marking helpful:', error);
      throw error;
    }
  }

  async getQuestion(questionId: string) {
    try {
      const question = await this.qaModel
        .findById(questionId)
        .populate('studentId', 'firstName lastName email avatar')
        .populate('instructorId', 'firstName lastName email avatar')
        .populate('courseId', 'title');

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      return question;
    } catch (error) {
      console.error('Error fetching question:', error);
      throw error;
    }
  }
}
