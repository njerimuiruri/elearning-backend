import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuestionAnswerService } from './question-answer.service';
import { EmailService } from '../common/services/email.service';

@Controller('questions')
@ApiTags('Questions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('jwt-auth')
export class QuestionAnswerController {
  constructor(
    private qaService: QuestionAnswerService,
    private emailService: EmailService,
  ) {}

  /**
   * Student asks a question about a lesson/module
   */
  @Post('ask')
  @ApiOperation({ summary: 'Post a new question about a lesson' })
  @ApiResponse({ status: 201, description: 'Question posted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid question data' })
  @HttpCode(HttpStatus.CREATED)
  async askQuestion(
    @Body() body: {
      courseId: string;
      title: string;
      content: string;
      moduleIndex?: number;
      lessonId?: string;
      priority?: string;
      tags?: string[];
    },
    @Req() request: any,
  ) {
    const studentId = request.user.userId;

    const result = await this.qaService.createQuestion(
      studentId,
      body.courseId,
      body,
    );

    // Email notification is handled by the service
    return result;
  }

  /**
   * Instructor responds to a student question
   */
  @Post(':questionId/respond')
  async respondToQuestion(
    @Param('questionId') questionId: string,
    @Body() body: { response: string; isPublic?: boolean },
    @Req() request?: any,
  ) {
    const instructorId = request?.user?.userId;

    const result = await this.qaService.respondToQuestion(
      questionId,
      instructorId,
      body.response,
      body.isPublic,
    );

    // Email notification is handled by the service
    return result;
  }

  /**
   * Student adds follow-up message to conversation
   */
  @Post(':questionId/follow-up')
  async addFollowUp(
    @Param('questionId') questionId: string,
    @Body() body: { message: string },
    @Req() request: any,
  ) {
    const studentId = request.user.userId;

    const result = await this.qaService.addFollowUpMessage(
      questionId,
      studentId,
      body.message,
    );

    // Get question to send email to instructor
    // This would notify instructor of follow-up

    return result;
  }

  /**
   * Get all questions for the logged-in student
   */
  @Get('student/my-questions')
  async getMyQuestions(
    @Query('courseId') courseId?: string,
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Req() request?: any,
  ) {
    const studentId = request?.user?.userId;

    return this.qaService.getStudentQuestions(
      studentId,
      courseId,
      status,
      page,
      limit,
    );
  }

  /**
   * Get all questions for a course (for instructor)
   */
  @Get('instructor/course/:courseId')
  async getCourseQuestions(
    @Param('courseId') courseId: string,
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Req() request?: any,
  ) {
    const instructorId = request?.user?.userId;

    return this.qaService.getInstructorQuestions(
      instructorId,
      courseId,
      status,
      page,
      limit,
    );
  }

  /**
   * Get instructor dashboard (all their questions across courses)
   */
  @Get('instructor/dashboard')
  async getInstructorDashboard(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Req() request: any,
  ) {
    const instructorId = request.user.userId;

    return this.qaService.getInstructorQuestions(
      instructorId,
      undefined,
      undefined,
      page,
      limit,
    );
  }

  /**
   * Get admin dashboard with all activities
   */
  @Get('admin/dashboard')
  async getAdminDashboard(
    @Query('courseId') courseId?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Req() request?: any,
  ) {
    // Verify user is admin
    if (request.user.role !== 'admin') {
      return { error: 'Unauthorized access' };
    }

    return this.qaService.getAdminDashboardData(courseId, page, limit);
  }

  /**
   * Get a single question with full conversation
   */
  @Get(':questionId')
  async getQuestion(@Param('questionId') questionId: string) {
    return this.qaService.getQuestion(questionId);
  }

  /**
   * Mark question as resolved
   */
  @Put(':questionId/resolve')
  async markResolved(
    @Param('questionId') questionId: string,
    @Req() request?: any,
  ) {
    return this.qaService.markAsResolved(questionId, request?.user?.userId);
  }

  /**
   * Rate the instructor's response
   */
  @Post(':questionId/rate')
  async rateResponse(
    @Param('questionId') questionId: string,
    @Body() body: { rating: number; feedback?: string },
    @Req() request: any,
  ) {
    return this.qaService.rateResponse(
      questionId,
      request.user.userId,
      body.rating,
      body.feedback,
    );
  }

  /**
   * Search questions
   */
  @Get('search/:courseId')
  async searchQuestions(
    @Param('courseId') courseId: string,
    @Query('q') searchTerm?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('resolved') isResolved?: boolean,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.qaService.searchQuestions(
      courseId,
      searchTerm,
      { status, category, priority, resolved: isResolved },
      page,
      limit,
    );
  }

  /**
   * Get similar/related questions
   */
  @Get(':questionId/similar')
  async getSimilarQuestions(@Param('questionId') questionId: string) {
    return this.qaService.getSimilarQuestions(questionId);
  }

  /**
   * Flag question for admin review
   */
  @Post(':questionId/flag')
  async flagQuestion(
    @Param('questionId') questionId: string,
    @Body() body: { reason: string; notes?: string },
    @Req() request: any,
  ) {
    if (request.user.role !== 'admin' && request.user.role !== 'instructor') {
      return { error: 'Unauthorized' };
    }

    return this.qaService.flagQuestion(questionId, body.reason, body.notes);
  }

  /**
   * Mark as helpful/unhelpful
   */
  @Post(':questionId/helpful')
  async markHelpful(
    @Param('questionId') questionId: string,
    @Body() body: { isHelpful: boolean },
    @Req() request: any,
  ) {
    return this.qaService.markHelpful(
      questionId,
      request.user.userId,
      body.isHelpful,
    );
  }

  /**
   * Delete a question (soft delete)
   */
  @Delete(':questionId')
  async deleteQuestion(
    @Param('questionId') questionId: string,
    @Req() request: any,
  ) {
    const question = await this.qaService.getQuestion(questionId);

    if (!question || question.studentId.toString() !== request.user.userId) {
      return { error: 'Unauthorized' };
    }

    await this.qaService.deleteQuestion(questionId);

    return { success: true, message: 'Question deleted' };
  }
}
