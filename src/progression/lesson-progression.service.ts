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
  lastAccessedSlide: number;
  lastAnswers?: Record<string, string>;
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
      console.log(`[QUIZ_EVALUATION_START] Enrollment: ${enrollmentId}, Lesson Index: ${lessonIndex}, Module: ${moduleId}`);
      
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

      if (!enrollment.lessonProgress) {
        enrollment.lessonProgress = [];
      }

      let lessonProgress = enrollment.lessonProgress.find(
        (lp) => lp.lessonIndex === lessonIndex,
      );

      // Guard: If the quiz was already passed, do not process attempts or update score
      if (lessonProgress?.assessmentPassed) {
        console.log(`[QUIZ_ALREADY_PASSED] Lesson ${lessonIndex} is already completed. Returning stored evaluation.`);
        
        // Reconstruct evaluation from stored answers if available
        const storedAnswers = (lessonProgress as any).lastAnswers || studentAnswers;
        const storedEvaluation = this.gradeQuiz(quiz, storedAnswers, passingScore);
        
        return {
          evaluation: storedEvaluation,
          lessonNowCompleted: true,
          canRetry: false,
          retriesRemaining: Math.max(0, maxAttempts - lessonProgress.assessmentAttempts),
        };
      }

      if (!lessonProgress) {
        const newLessonProgress = {
          lessonIndex,
          isCompleted: false,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
          slideProgress: [],
          completedSlides: 0,
          lastAccessedSlide: 0,
        };
        enrollment.lessonProgress.push(newLessonProgress);
        lessonProgress = newLessonProgress;
      }

      lessonProgress.assessmentAttempts += 1;
      lessonProgress.lastScore = evaluation.percentage;
      
      // Persist student answers for later review (schema field, persisted to DB)
      (lessonProgress as any).lastAnswers = studentAnswers;
      console.log(`[QUIZ_SAVE_ANSWERS] Saving lastAnswers for Lesson ${lessonIndex}:`, JSON.stringify(studentAnswers));

      const passed = evaluation.percentage >= passingScore;
      const canRetry =
        !passed && lessonProgress.assessmentAttempts < maxAttempts;

      if (passed) {
        lessonProgress.assessmentPassed = true;
        lessonProgress.isCompleted = true;
        lessonProgress.completedAt = new Date();
      }

      console.log(`[QUIZ_SAVE_TO_BACKEND] Saving results: Passed=${passed}, Score=${evaluation.percentage}%, Attempts Used=${lessonProgress.assessmentAttempts}`);
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
      console.log(`[markLessonCompleted] Attempting to complete Lesson ${lessonIndex} for Enrollment ${enrollmentId}`);
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      if (!enrollment.lessonProgress) {
        enrollment.lessonProgress = [];
      }

      let lessonProgress = enrollment.lessonProgress.find(
        (lp) => lp.lessonIndex === lessonIndex,
      );

      // Guard: If already completed, no need to update
      if (lessonProgress?.isCompleted) {
        console.log(`[LESSON_STATUS_CHECK] Lesson ${lessonIndex} is already marked as completed. Skipping update.`);
        return;
      }

      if (!lessonProgress) {
        const newLessonProgress = {
          lessonIndex,
          isCompleted: false,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
          slideProgress: [],
          completedSlides: 0,
          lastAccessedSlide: 0,
        };
        enrollment.lessonProgress.push(newLessonProgress);
        lessonProgress = newLessonProgress;
      }

      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = new Date();

      console.log(`[LESSON_COMPLETION_SAVE] Marking Lesson ${lessonIndex} as permanently DONE for Enrollment ${enrollmentId}`);
      await enrollment.save();
    } catch (error) {
      throw new BadRequestException(
        `Failed to mark lesson completed: ${error.message}`,
      );
    }
  }

  async updateLessonSlideProgress(
    enrollmentId: string,
    lessonIndex: number,
    slideIndex: number,
  ): Promise<void> {
    try {
      console.log(`[SLIDE_PROGRESS_SAVE] Saving Slide Index: ${slideIndex} for Lesson: ${lessonIndex}, Enrollment: ${enrollmentId}`);
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      if (!enrollment.lessonProgress) {
        enrollment.lessonProgress = [];
      }

      let lessonProgress = enrollment.lessonProgress.find(
        (lp) => lp.lessonIndex === lessonIndex,
      );

      if (!lessonProgress) {
        const newLessonProgress = {
          lessonIndex,
          isCompleted: false,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
          slideProgress: [],
          completedSlides: 0,
          lastAccessedSlide: slideIndex,
        };
        enrollment.lessonProgress.push(newLessonProgress);
      } else {
        lessonProgress.lastAccessedSlide = slideIndex;
      }

      await enrollment.save();
    } catch (error) {
      throw new BadRequestException(
        `Failed to update slide progress: ${error.message}`,
      );
    }
  }

  async getNextIncompleteLesson(
    enrollmentId: string,
    totalLessons: number,
  ): Promise<{
    lessonIndex: number | null;
    lastAccessedSlide: number;
    reason: string;
  }> {
    try {
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new NotFoundException('Enrollment not found');
      }

      console.log(`[RESUME_POINT_CALCULATION] Checking progress for Enrollment: ${enrollmentId}`);

      for (let i = 0; i < totalLessons; i++) {
        const isCompleted = this.isLessonCompleted(enrollment, i);
        const isAccessible = await this.canAccessLesson(enrollmentId, i);

        if (!isCompleted && isAccessible.canAccess) {
          const lessonProgress = enrollment.lessonProgress?.find(
            (lp) => lp.lessonIndex === i,
          );
          
          const resumePoint = {
            lessonIndex: i,
            lastAccessedSlide: lessonProgress?.lastAccessedSlide ?? 0,
            reason: `Resume at Lesson ${i + 1}, Slide ${lessonProgress?.lastAccessedSlide ?? 0}`,
          };
          
          console.log(`[RESUME_POINT_FOUND] Student should resume exactly at:`, resumePoint);
          return resumePoint;
        }
      }

      console.log(`[RESUME_POINT_NONE] All lessons are completed.`);
      return {
        lessonIndex: null,
        lastAccessedSlide: 0,
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

      console.log(`[DATA_RETRIEVAL_LOGIN] Fetching full progression summary for Enrollment ${enrollmentId}`);

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
          lastAccessedSlide: lessonProgress?.lastAccessedSlide ?? 0,
          lastAnswers: (lessonProgress as any)?.lastAnswers,
        });
      }

      const completedList = lessons.filter(l => l.isCompleted).map(l => l.lessonIndex);
      console.log(`[PROGRESS_RETRIEVE_SUCCESS] Completed Lessons: [${completedList.join(', ')}], Progress: ${Math.round((completedLessons / totalLessons) * 100)}%`);

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

      // "Never reset or unmarked under any circumstance" - if it's completed, we block reset.
      if (lessonProgress?.isCompleted) {
        console.warn(`[PROGRESS_RESET_DENIED] Attempted to reset already completed Lesson ${lessonIndex}. Operation blocked per integrity rules.`);
        return;
      }

      if (lessonProgress) {
        lessonProgress.isCompleted = false;
        lessonProgress.assessmentPassed = false;
        lessonProgress.assessmentAttempts = 0;
        lessonProgress.lastScore = 0;
        lessonProgress.completedAt = undefined;
        lessonProgress.slideProgress = [];
        lessonProgress.completedSlides = 0;
      }

      console.log(`[PROGRESS_RESET_SAVE] Resetting progress for incomplete Lesson ${lessonIndex}`);
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