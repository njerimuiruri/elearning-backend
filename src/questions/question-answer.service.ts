import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QuestionAnswer, QuestionAnswerDocument } from './schemas/question-answer.schema';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class QuestionAnswerService {
  constructor(
    @InjectModel(QuestionAnswer.name)
    private questionModel: Model<QuestionAnswerDocument>,
    private emailService: EmailService,
  ) {}

  /**
   * Create a new question from a student
   */
  async createQuestion(studentId: string, courseId: string, questionData: any) {
    try {
      const category = this.categorizeQuestion(questionData.questionContent);
      const suggestion = this.generateAISuggestedAnswer(category, questionData.questionContent);

      const question = new this.questionModel({
        studentId: new Types.ObjectId(studentId),
        courseId: new Types.ObjectId(courseId),
        questionTitle: questionData.questionTitle,
        questionContent: questionData.questionContent,
        tags: questionData.tags || [],
        moduleIndex: questionData.moduleIndex,
        lessonId: questionData.lessonId ? new Types.ObjectId(questionData.lessonId) : null,
        priority: questionData.priority || 'medium',
        questionCategory: category,
        aiSuggestedAnswer: suggestion,
        aiConfidenceScore: this.calculateConfidence(category),
        status: 'unanswered',
      });

      return await question.save();
    } catch (error) {
      throw new BadRequestException(`Failed to create question: ${error.message}`);
    }
  }

  /**
   * Respond to a question (instructor only)
   */
  async respondToQuestion(questionId: string, instructorId: string, response: string, isPublic: boolean = false) {
    try {
      const question = await this.questionModel.findById(questionId);
      if (!question) throw new NotFoundException('Question not found');

      const respondedAt = new Date();
      const createdDate = question.readAt || new Date(); // Fallback to current date
      const responseTime = Math.round((respondedAt.getTime() - createdDate.getTime()) / (1000 * 60 * 60)); // hours

      question.instructorResponse = response;
      question.respondedAt = respondedAt;
      question.instructorId = new Types.ObjectId(instructorId);
      question.status = 'answered';
      question.responseTime = responseTime;
      question.isPublic = isPublic;

      // Add to conversation thread
      question.conversationThread.push({
        senderId: new Types.ObjectId(instructorId),
        senderType: 'instructor',
        message: response,
        createdAt: respondedAt,
      });

      return await question.save();
    } catch (error) {
      throw new BadRequestException(`Failed to respond to question: ${error.message}`);
    }
  }

  /**
   * Add a follow-up message to the conversation
   */
  async addFollowUpMessage(questionId: string, userId: string, message: string, userType: 'student' | 'instructor' = 'student') {
    try {
      const question = await this.questionModel.findById(questionId);
      if (!question) throw new NotFoundException('Question not found');

      question.conversationThread.push({
        senderId: new Types.ObjectId(userId),
        senderType: userType,
        message,
        createdAt: new Date(),
      });

      if (userType === 'student') {
        question.status = 'pending'; // Waiting for instructor response again
      }

      return await question.save();
    } catch (error) {
      throw new BadRequestException(`Failed to add follow-up: ${error.message}`);
    }
  }

  /**
   * Get all questions asked by a student
   */
  async getStudentQuestions(studentId: string, courseId?: string, status?: string, page: number = 1, limit: number = 10) {
    try {
      const filter: any = { studentId: new Types.ObjectId(studentId) };
      if (courseId) filter.courseId = new Types.ObjectId(courseId);
      if (status) filter.status = status;

      const skip = (page - 1) * limit;
      const questions = await this.questionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('studentId', 'name email')
        .populate('instructorId', 'name email')
        .populate('courseId', 'title');

      const total = await this.questionModel.countDocuments(filter);

      return {
        data: questions,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve questions: ${error.message}`);
    }
  }

  /**
   * Get all questions assigned to an instructor
   */
  async getInstructorQuestions(instructorId: string, courseId?: string, status?: string, page: number = 1, limit: number = 10) {
    try {
      const filter: any = {};
      if (courseId) filter.courseId = new Types.ObjectId(courseId);
      if (status) filter.status = status;

      // Get questions where this instructor is assigned or the course is theirs
      filter.$or = [
        { instructorId: new Types.ObjectId(instructorId) },
        // You may want to add logic to find courses where this user is the instructor
      ];

      const skip = (page - 1) * limit;
      const questions = await this.questionModel
        .find(filter)
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('studentId', 'name email')
        .populate('courseId', 'title');

      const total = await this.questionModel.countDocuments(filter);
      const stats = await this.getInstructorStats(instructorId);

      return {
        data: questions,
        stats,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve instructor questions: ${error.message}`);
    }
  }

  /**
   * Get statistics for an instructor
   */
  async getInstructorStats(instructorId: string) {
    try {
      const stats = await this.questionModel.aggregate([
        { $match: { instructorId: new Types.ObjectId(instructorId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]);

      const avgRating = await this.questionModel.aggregate([
        { $match: { instructorId: new Types.ObjectId(instructorId), studentRating: { $exists: true } } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$studentRating' },
            avgResponseTime: { $avg: '$responseTime' },
          },
        },
      ]);

      return {
        byStatus: stats,
        avgRating: avgRating[0]?.avgRating || 0,
        avgResponseTime: avgRating[0]?.avgResponseTime || 0,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to calculate stats: ${error.message}`);
    }
  }

  /**
   * Get admin dashboard data (system-wide overview)
   */
  async getAdminDashboardData(courseId?: string, page: number = 1, limit: number = 20) {
    try {
      const filter: any = {};
      if (courseId) filter.courseId = new Types.ObjectId(courseId);

      const skip = (page - 1) * limit;
      const questions = await this.questionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('studentId', 'name email')
        .populate('instructorId', 'name email')
        .populate('courseId', 'title');

      const systemStats = await this.getSystemStats(courseId);
      const recentActivity = await this.getRecentActivity(courseId, 10);
      const flaggedQuestions = await this.questionModel.find({ flaggedByAdmin: true }).limit(5);

      return {
        questions,
        systemStats,
        recentActivity,
        flaggedQuestions,
        pagination: { page, limit },
      };
    } catch (error) {
      throw new BadRequestException(`Failed to fetch admin dashboard: ${error.message}`);
    }
  }

  /**
   * Get system-wide statistics
   */
  async getSystemStats(courseId?: string) {
    try {
      const filter: any = {};
      if (courseId) filter.courseId = new Types.ObjectId(courseId);

      const total = await this.questionModel.countDocuments(filter);
      const byStatus = await this.questionModel.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);

      const byCategory = await this.questionModel.aggregate([
        { $match: filter },
        { $group: { _id: '$questionCategory', count: { $sum: 1 } } },
      ]);

      const byPriority = await this.questionModel.aggregate([
        { $match: filter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]);

      const avgResponseTime = await this.questionModel.aggregate([
        { $match: { ...filter, responseTime: { $exists: true } } },
        { $group: { _id: null, avg: { $avg: '$responseTime' } } },
      ]);

      const avgRating = await this.questionModel.aggregate([
        { $match: { ...filter, studentRating: { $exists: true } } },
        { $group: { _id: null, avg: { $avg: '$studentRating' } } },
      ]);

      return {
        total,
        byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
        byCategory: Object.fromEntries(byCategory.map((c) => [c._id, c.count])),
        byPriority: Object.fromEntries(byPriority.map((p) => [p._id, p.count])),
        avgResponseTime: avgResponseTime[0]?.avg || 0,
        avgRating: avgRating[0]?.avg || 0,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to calculate system stats: ${error.message}`);
    }
  }

  /**
   * Get recent activity timeline
   */
  async getRecentActivity(courseId?: string, limit: number = 20) {
    try {
      const filter: any = {};
      if (courseId) filter.courseId = new Types.ObjectId(courseId);

      const activity = await this.questionModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('studentId instructorId courseId questionTitle status respondedAt createdAt')
        .populate('studentId', 'name')
        .populate('instructorId', 'name');

      return activity;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch activity: ${error.message}`);
    }
  }

  /**
   * Mark a question as resolved
   */
  async markAsResolved(questionId: string, resolvedBy: string) {
    try {
      const question = await this.questionModel.findByIdAndUpdate(
        questionId,
        {
          isResolved: true,
          resolvedAt: new Date(),
          status: 'resolved',
        },
        { new: true },
      );

      if (!question) throw new NotFoundException('Question not found');
      return question;
    } catch (error) {
      throw new BadRequestException(`Failed to resolve question: ${error.message}`);
    }
  }

  /**
   * Rate an instructor's response
   */
  async rateResponse(questionId: string, studentId: string, rating: number, feedback?: string) {
    try {
      if (rating < 1 || rating > 5) throw new BadRequestException('Rating must be between 1 and 5');

      const question = await this.questionModel.findByIdAndUpdate(
        questionId,
        {
          studentRating: rating,
          studentFeedback: feedback || '',
          helpfulness: rating,
        },
        { new: true },
      );

      if (!question) throw new NotFoundException('Question not found');
      return question;
    } catch (error) {
      throw new BadRequestException(`Failed to rate response: ${error.message}`);
    }
  }

  /**
   * Search questions with filters
   */
  async searchQuestions(
    courseId: string,
    searchTerm?: string,
    filters?: { status?: string; category?: string; priority?: string; resolved?: boolean },
    page: number = 1,
    limit: number = 10,
  ) {
    try {
      const query: any = { courseId: new Types.ObjectId(courseId) };

      if (searchTerm) {
        query.$or = [
          { questionTitle: { $regex: searchTerm, $options: 'i' } },
          { questionContent: { $regex: searchTerm, $options: 'i' } },
          { tags: { $regex: searchTerm, $options: 'i' } },
        ];
      }

      if (filters?.status) query.status = filters.status;
      if (filters?.category) query.questionCategory = filters.category;
      if (filters?.priority) query.priority = filters.priority;
      if (filters?.resolved !== undefined) query.isResolved = filters.resolved;

      const skip = (page - 1) * limit;
      const results = await this.questionModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('studentId', 'name email');

      const total = await this.questionModel.countDocuments(query);

      return {
        data: results,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    } catch (error) {
      throw new BadRequestException(`Search failed: ${error.message}`);
    }
  }

  /**
   * Get similar questions (keyword-based)
   */
  async getSimilarQuestions(questionId: string) {
    try {
      const question = await this.questionModel.findById(questionId);
      if (!question) throw new NotFoundException('Question not found');

      const keywords = [
        ...question.tags,
        ...question.questionTitle.split(' '),
        ...question.questionContent.split(' '),
      ];

      const similar = await this.questionModel
        .find({
          _id: { $ne: questionId },
          courseId: question.courseId,
          $or: [{ tags: { $in: keywords } }, { questionTitle: { $regex: keywords.join('|'), $options: 'i' } }],
        })
        .limit(5)
        .select('questionTitle questionCategory status studentRating');

      return similar;
    } catch (error) {
      throw new BadRequestException(`Failed to find similar questions: ${error.message}`);
    }
  }

  /**
   * Flag a question for admin review
   */
  async flagQuestion(questionId: string, reason: string, notes?: string) {
    try {
      const question = await this.questionModel.findByIdAndUpdate(
        questionId,
        {
          flaggedByAdmin: true,
          adminNotes: notes || reason,
        },
        { new: true },
      );

      if (!question) throw new NotFoundException('Question not found');
      return question;
    } catch (error) {
      throw new BadRequestException(`Failed to flag question: ${error.message}`);
    }
  }

  /**
   * Mark answer as helpful
   */
  async markHelpful(questionId: string, userId: string, isHelpful: boolean = true) {
    try {
      const question = await this.questionModel.findById(questionId);
      if (!question) throw new NotFoundException('Question not found');

      const userObjectId = new Types.ObjectId(userId);
      const alreadyVoted = question.helpfulVotes.includes(userObjectId);

      if (isHelpful && !alreadyVoted) {
        question.helpfulVotes.push(userObjectId);
        question.helpfulCount += 1;
      } else if (!isHelpful && alreadyVoted) {
        question.helpfulVotes = question.helpfulVotes.filter((id) => !id.equals(userObjectId));
        question.helpfulCount = Math.max(0, question.helpfulCount - 1);
      }

      return await question.save();
    } catch (error) {
      throw new BadRequestException(`Failed to mark helpful: ${error.message}`);
    }
  }

  /**
   * Categorize question based on content (AI logic)
   */
  private categorizeQuestion(content: string): string {
    const lowerContent = content.toLowerCase();

    if (lowerContent.match(/bug|error|not working|issue|crash|fail/)) return 'technical';
    if (lowerContent.match(/explain|understand|how does|why|concept|theory/)) return 'conceptual';
    if (lowerContent.match(/assignment|quiz|exam|grade|test|assessment/)) return 'assessment';

    return 'general';
  }

  /**
   * Generate AI suggested answer (template-based, can be replaced with OpenAI)
   */
  private generateAISuggestedAnswer(category: string, content: string): string {
    const templates = {
      technical: 'Based on your technical question, please check the documentation or try the following approach...',
      conceptual: 'This is an important concept. Here are the key points to understand...',
      assessment: 'For assessment-related questions, I recommend reviewing the course materials and consulting your instructor directly.',
      general: 'Great question! Here is some helpful information...',
    };

    return templates[category] || templates.general;
  }

  /**
   * Calculate AI confidence score
   */
  private calculateConfidence(category: string): number {
    const scores = {
      technical: 0.7,
      conceptual: 0.6,
      assessment: 0.5,
      general: 0.5,
    };

    return scores[category] || 0.5;
  }

  /**
   * Get a single question with full details
   */
  async getQuestion(questionId: string) {
    try {
      const question = await this.questionModel
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

  /**
   * Delete a question permanently
   */
  async deleteQuestion(questionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.questionModel.findByIdAndDelete(questionId);

      if (!result) {
        throw new NotFoundException('Question not found');
      }

      return { success: true, message: 'Question deleted successfully' };
    } catch (error) {
      console.error('Error deleting question:', error);
      throw error;
    }
  }
}
