import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { Module } from '../schemas/module.schema';

export interface LessonAccessInfo {
  canAccess: boolean;
  reason?: string;
  isCompleted: boolean;
  isLocked: boolean;
  lockReason?: string;
  completionRequirements?: string[];
}

export interface QuizEvaluationResult {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  questionsCorrect: number;
  questionsTotal: number;
  answers: {
    questionIndex: number;
    question: string;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    points: number;
  }[];
}

export interface LessonSummaryItem {
  lessonIndex: number;
  isCompleted: boolean;
  isAssessmentPassed: boolean;
  attempts: number;
  score: number;
  canAccess: boolean;
}

@Injectable()
export class LessonProgressionService {
  constructor(
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(Module.name)
    private moduleModel: Model<Module>,
  ) {}

  async canAccessLesson(
    enrollmentId: string,
    lessonIndex: number,
  ): Promise<LessonAccessInfo> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      if (lessonIndex === 0) {
        return {
          canAccess: true,
          isCompleted: this.isLessonCompleted(enrollment, lessonIndex),
          isLocked: false,
        };
      }

      const previousLessonIndex = lessonIndex - 1;
      const previousLessonCompleted = this.isLessonCompleted(
        enrollment,
        previousLessonIndex,
      );

      if (!previousLessonCompleted) {
        return {
          canAccess: false,
          isCompleted: false,
          isLocked: true,
          lockReason: `Lesson ${previousLessonIndex + 1} must be completed first`,
          completionRequirements: [
            `Complete Lesson ${previousLessonIndex + 1}`,
            `Pass the quiz (if available)`,
          ],
        };
      }

      return {
        canAccess: true,
        isCompleted: this.isLessonCompleted(enrollment, lessonIndex),
        isLocked: false,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to check lesson access: ${error.message}`,
      );
    }
  }

  async evaluateQuiz(
    enrollmentId: string,
    lessonIndex: number,
    studentAnswers: Record<string, string>,
    moduleId: string,
  ): Promise<{
    evaluation: QuizEvaluationResult;
    lessonNowCompleted: boolean;
    canRetry: boolean;
    retriesRemaining: number;
  }> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      const module = await this.moduleModel.findById(moduleId);
      if (!module) {
        throw new NotFoundException('Module not found');
      }

      const lesson = module.lessons?.[lessonIndex];
      if (!lesson) {
        throw new NotFoundException('Lesson not found');
      }

      const quiz = lesson.assessmentQuiz || [];
      if (quiz.length === 0) {
        throw new BadRequestException('This lesson has no quiz');
      }

      const passingScore = lesson.quizPassingScore ?? 70;
      const maxAttempts = lesson.quizMaxAttempts ?? 3;

      const evaluation = this.gradeQuiz(quiz, studentAnswers, passingScore);

      let lessonProgress = enrollment.lessonProgress?.find(
        (lp) => lp.lessonIndex === lessonIndex,
      );

      if (!lessonProgress) {
        lessonProgress = {
          lessonIndex,
          isCompleted: false,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
          slideProgress: [],
          completedSlides: 0,
        };
        if (!enrollment.lessonProgress) {
          enrollment.lessonProgress = [];
        }
        enrollment.lessonProgress.push(lessonProgress);
      }

      lessonProgress.assessmentAttempts += 1;
      lessonProgress.lastScore = evaluation.percentage;

      const passed = evaluation.percentage >= passingScore;
      const canRetry =
        !passed && lessonProgress.assessmentAttempts < maxAttempts;

      if (passed) {
        lessonProgress.assessmentPassed = true;
        lessonProgress.isCompleted = true;
        lessonProgress.completedAt = new Date();
      }

      await enrollment.save();

      return {
        evaluation,
        lessonNowCompleted: lessonProgress.isCompleted,
        canRetry,
        retriesRemaining: Math.max(0, maxAttempts - lessonProgress.assessmentAttempts),
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to evaluate quiz: ${error.message}`,
      );
    }
  }

  async markLessonCompleted(
    enrollmentId: string,
    lessonIndex: number,
  ): Promise<void> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      let lessonProgress = enrollment.lessonProgress?.find(
        (lp) => lp.lessonIndex === lessonIndex,
      );

      if (!lessonProgress) {
        lessonProgress = {
          lessonIndex,
          isCompleted: false,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
          slideProgress: [],
          completedSlides: 0,
        };
        if (!enrollment.lessonProgress) {
          enrollment.lessonProgress = [];
        }
        enrollment.lessonProgress.push(lessonProgress);
      }

      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = new Date();

      await enrollment.save();
    } catch (error) {
      throw new BadRequestException(
        `Failed to mark lesson completed: ${error.message}`,
      );
    }
  }

  async getNextIncompleteLesson(
    enrollmentId: string,
    totalLessons: number,
  ): Promise<{
    lessonIndex: number | null;
    reason: string;
  }> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      for (let i = 0; i < totalLessons; i++) {
        const isCompleted = this.isLessonCompleted(enrollment, i);
        const isAccessible = await this.canAccessLesson(enrollmentId, i);

        if (!isCompleted && isAccessible.canAccess) {
          return {
            lessonIndex: i,
            reason: `Continue with Lesson ${i + 1}`,
          };
        }
      }

      return {
        lessonIndex: null,
        reason: 'All lessons completed',
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get next lesson: ${error.message}`,
      );
    }
  }

  async getLessonProgressSummary(
    enrollmentId: string,
    totalLessons: number,
  ): Promise<{
    completedLessons: number;
    totalLessons: number;
    completionPercentage: number;
    lessons: LessonSummaryItem[];
  }> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      let completedLessons = 0;
      const lessons: LessonSummaryItem[] = [];

      for (let i = 0; i < totalLessons; i++) {
        const isCompleted = this.isLessonCompleted(enrollment, i);
        const access = await this.canAccessLesson(enrollmentId, i);
        const lessonProgress = enrollment.lessonProgress?.find(
          (lp) => lp.lessonIndex === i,
        );

        if (isCompleted) completedLessons++;

        lessons.push({
          lessonIndex: i,
          isCompleted,
          isAssessmentPassed: lessonProgress?.assessmentPassed ?? false,
          attempts: lessonProgress?.assessmentAttempts ?? 0,
          score: lessonProgress?.lastScore ?? 0,
          canAccess: access.canAccess,
        });
      }

      return {
        completedLessons,
        totalLessons,
        completionPercentage: Math.round(
          (completedLessons / totalLessons) * 100,
        ),
        lessons,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get lesson summary: ${error.message}`,
      );
    }
  }

  async resetLessonProgress(
    enrollmentId: string,
    lessonIndex: number,
  ): Promise<void> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      const lessonProgress = enrollment.lessonProgress?.find(
        (lp) => lp.lessonIndex === lessonIndex,
      );

      if (lessonProgress) {
        lessonProgress.isCompleted = false;
        lessonProgress.assessmentPassed = false;
        lessonProgress.assessmentAttempts = 0;
        lessonProgress.lastScore = 0;
        lessonProgress.completedAt = undefined;
        lessonProgress.slideProgress = [];
        lessonProgress.completedSlides = 0;
      }

      await enrollment.save();
    } catch (error) {
      throw new BadRequestException(
        `Failed to reset lesson progress: ${error.message}`,
      );
    }
  }

  async lockLessonForRetry(
    enrollmentId: string,
    lessonIndex: number,
  ): Promise<void> {
    await this.resetLessonProgress(enrollmentId, lessonIndex);
  }

  private isLessonCompleted(enrollment: any, lessonIndex: number): boolean {
    const lessonProgress = enrollment.lessonProgress?.find(
      (lp: any) => lp.lessonIndex === lessonIndex,
    );
    return lessonProgress?.isCompleted ?? false;
  }

  private gradeQuiz(
    quiz: any[],
    studentAnswers: Record<string, string>,
    passingScore: number,
  ): QuizEvaluationResult {
    let totalPoints = 0;
    let earnedPoints = 0;
    let correctCount = 0;

    const answers = quiz.map((question, index) => {
      const studentAnswer = studentAnswers[index.toString()] || '';
      const isCorrect =
        studentAnswer.toLowerCase().trim() ===
        question.answer.toLowerCase().trim();

      const points = question.points || 1;
      if (isCorrect) {
        correctCount++;
        earnedPoints += points;
      }

      totalPoints += points;

      return {
        questionIndex: index,
        question: question.question,
        studentAnswer,
        correctAnswer: question.answer,
        isCorrect,
        points: isCorrect ? points : 0,
      };
    });

    const percentage = totalPoints > 0
      ? Math.round((earnedPoints / totalPoints) * 100)
      : 0;

    return {
      score: earnedPoints,
      maxScore: totalPoints,
      percentage,
      passed: percentage >= passingScore,
      questionsCorrect: correctCount,
      questionsTotal: quiz.length,
      answers,
    };
  }
}