import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  LessonProgressionService,
  LessonAccessInfo,
  QuizEvaluationResult,
  LessonSummaryItem,
} from './lesson-progression.service';

@Controller('lessons/progression')
@UseGuards(AuthGuard('jwt'))
export class LessonProgressionController {
  constructor(private lessonProgressionService: LessonProgressionService) {}

  @Get(':enrollmentId/can-access/:lessonIndex')
  async canAccessLesson(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
  ): Promise<LessonAccessInfo> {
    const index = parseInt(lessonIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('Invalid lesson index');
    }
    return await this.lessonProgressionService.canAccessLesson(enrollmentId, index);
  }

  @Post(':enrollmentId/evaluate-quiz/:lessonIndex')
  async evaluateQuiz(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
    @Body() body: { answers: Record<string, string>; moduleId: string },
  ): Promise<{
    evaluation: QuizEvaluationResult;
    lessonNowCompleted: boolean;
    canRetry: boolean;
    retriesRemaining: number;
  }> {
    const index = parseInt(lessonIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('Invalid lesson index');
    }
    if (!body.moduleId) {
      throw new BadRequestException('Module ID is required');
    }
    if (!body.answers || typeof body.answers !== 'object') {
      throw new BadRequestException('Invalid answers format');
    }
    return await this.lessonProgressionService.evaluateQuiz(
      enrollmentId,
      index,
      body.answers,
      body.moduleId,
    );
  }

  @Post(':enrollmentId/complete/:lessonIndex')
  async markLessonCompleted(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
  ): Promise<{ success: boolean; message: string }> {
    const index = parseInt(lessonIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('Invalid lesson index');
    }
    await this.lessonProgressionService.markLessonCompleted(enrollmentId, index);
    return { success: true, message: 'Lesson marked as completed' };
  }

  @Get(':enrollmentId/next-lesson/:totalLessons')
  async getNextIncompleteLesson(
    @Param('enrollmentId') enrollmentId: string,
    @Param('totalLessons') totalLessons: string,
  ): Promise<{ lessonIndex: number | null; reason: string }> {
    const total = parseInt(totalLessons, 10);
    if (isNaN(total)) {
      throw new BadRequestException('Invalid total lessons count');
    }
    return await this.lessonProgressionService.getNextIncompleteLesson(enrollmentId, total);
  }

  @Get(':enrollmentId/summary/:totalLessons')
  async getLessonProgressSummary(
    @Param('enrollmentId') enrollmentId: string,
    @Param('totalLessons') totalLessons: string,
  ): Promise<{
    completedLessons: number;
    totalLessons: number;
    completionPercentage: number;
    lessons: LessonSummaryItem[];
  }> {
    const total = parseInt(totalLessons, 10);
    if (isNaN(total)) {
      throw new BadRequestException('Invalid total lessons count');
    }
    return await this.lessonProgressionService.getLessonProgressSummary(enrollmentId, total);
  }

  @Post(':enrollmentId/reset/:lessonIndex')
  async resetLessonProgress(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
  ): Promise<{ success: boolean; message: string }> {
    const index = parseInt(lessonIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('Invalid lesson index');
    }
    await this.lessonProgressionService.resetLessonProgress(enrollmentId, index);
    return { success: true, message: 'Lesson progress reset' };
  }
}