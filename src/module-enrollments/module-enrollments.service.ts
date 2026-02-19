import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { Module, ModuleStatus } from '../schemas/module.schema';
import { ModuleCertificate } from '../schemas/module-certificate.schema';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import { SubmitFinalAssessmentDto, SubmitLessonAssessmentDto } from './dto/submit-assessment.dto';
import { ProgressionService } from '../progression/progression.service';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../schemas/notification.schema';

@Injectable()
export class ModuleEnrollmentsService {
  constructor(
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(Module.name)
    private moduleModel: Model<Module>,
    @InjectModel(ModuleCertificate.name)
    private certificateModel: Model<ModuleCertificate>,
    @InjectModel(Category.name)
    private categoryModel: Model<Category>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    @Inject(forwardRef(() => ProgressionService))
    private progressionService: ProgressionService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  // Enroll in module (with payment check for paid categories)
  async enrollInModule(
    studentId: string,
    moduleId: string,
  ): Promise<ModuleEnrollment | { requiresPayment: boolean; categoryId: string; price: number; categoryName: string }> {
    const module = await this.moduleModel.findById(moduleId).populate('categoryId');
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (module.status !== ModuleStatus.PUBLISHED) {
      throw new BadRequestException('Module is not published');
    }

    // ── Access gate ──────────────────────────────────────────────────────────
    const category = module.categoryId as any;
    if (category) {
      const user = await this.userModel.findById(studentId);

      // Admin bypasses all checks
      if (user?.role !== 'admin') {
        const hasFellowAccess =
          user?.fellowData?.assignedCategories?.some(
            (catId: any) => catId.toString() === category._id.toString(),
          ) || false;

        const hasPurchasedAccess =
          user?.purchasedCategories?.some(
            (catId: any) => catId.toString() === category._id.toString(),
          ) || false;

        // FREE category → fellow-only free access; non-fellows are blocked entirely
        if (category.accessType === 'free') {
          if (!hasFellowAccess) {
            throw new ForbiddenException(
              'This module is free only for fellows added by the admin. Please contact the admin to get access.',
            );
          }
          // Fellow → fall through to enroll for free
        }

        // PAID category → fellows free, others must pay
        else if (category.isPaid || category.accessType === 'paid') {
          const hasRoleAccess =
            category.allowedRoles?.includes(user?.role) || false;

          if (!hasFellowAccess && !hasPurchasedAccess && !hasRoleAccess) {
            return {
              requiresPayment: true,
              categoryId: category._id.toString(),
              price: category.price,
              categoryName: category.name,
            };
          }
          // Fellow or purchased → fall through to enroll
        }
      }
    }

    // ── Level access gate ──────────────────────────────────────────────────
    // Beginner is always accessible; intermediate/advanced require the
    // previous level to be fully completed and passed.
    if (category && module.level && module.level !== 'beginner') {
      const canAccess = await this.progressionService.canAccessLevel(
        studentId,
        category._id.toString(),
        module.level,
      );
      if (!canAccess) {
        const levelLabel = module.level === 'intermediate' ? 'Beginner' : 'Intermediate';
        throw new ForbiddenException(
          `You must complete and pass all ${levelLabel} modules before accessing ${module.level} content.`,
        );
      }
    }

    // Check existing enrollment
    let enrollment = await this.enrollmentModel.findOne({
      studentId: new Types.ObjectId(studentId),
      moduleId: new Types.ObjectId(moduleId),
    });

    if (enrollment) {
      return enrollment;
    }

    // Initialize progression for this category if needed
    await this.progressionService.initializeProgression(
      studentId,
      category._id.toString(),
    );

    // Create enrollment
    enrollment = new this.enrollmentModel({
      studentId: new Types.ObjectId(studentId),
      moduleId: new Types.ObjectId(moduleId),
      totalLessons: module.lessons.length,
      lessonProgress: module.lessons.map((_, index) => ({
        lessonIndex: index,
        isCompleted: false,
      })),
    });

    await enrollment.save();

    // Update module enrollment count
    await this.moduleModel.findByIdAndUpdate(moduleId, {
      $inc: { enrollmentCount: 1 },
    });

    return enrollment;
  }

  // Get student's enrollments
  async getStudentEnrollments(studentId: string) {
    return await this.enrollmentModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .populate({
        path: 'moduleId',
        select: 'title description level bannerUrl categoryId duration lessons',
        populate: { path: 'categoryId', select: 'name' },
      })
      .sort({ createdAt: -1 })
      .lean();
  }

  // Get enrollment details
  async getEnrollmentById(enrollmentId: string): Promise<ModuleEnrollment> {
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate({
        path: 'moduleId',
        populate: {
          path: 'instructorIds categoryId',
          select: 'firstName lastName name price',
        },
      });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return enrollment;
  }

  // Get enrollment by student and module
  async getEnrollmentByStudentAndModule(
    studentId: string,
    moduleId: string,
  ): Promise<ModuleEnrollment | null> {
    return await this.enrollmentModel
      .findOne({
        studentId: new Types.ObjectId(studentId),
        moduleId: new Types.ObjectId(moduleId),
      })
      .populate({
        path: 'moduleId',
        populate: {
          path: 'instructorIds categoryId',
          select: 'firstName lastName name price',
        },
      });
  }

  // Complete lesson
  async completeLesson(
    enrollmentId: string,
    lessonIndex: number,
  ): Promise<ModuleEnrollment> {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const lessonProgress = enrollment.lessonProgress.find(
      (lp) => lp.lessonIndex === lessonIndex,
    );

    if (!lessonProgress) {
      throw new NotFoundException('Lesson not found');
    }

    if (!lessonProgress.isCompleted) {
      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = new Date();
      enrollment.completedLessons++;

      // Update overall progress
      enrollment.progress = Math.round(
        (enrollment.completedLessons / enrollment.totalLessons) * 100,
      );

      // If student completed all lessons after a forced module repeat,
      // clear the block so they can retake the final assessment.
      if (
        enrollment.requiresModuleRepeat &&
        enrollment.completedLessons >= enrollment.totalLessons
      ) {
        enrollment.requiresModuleRepeat = false;
      }

      enrollment.lastAccessedLesson = lessonIndex;
      enrollment.lastAccessedAt = new Date();

      await enrollment.save();
    }

    return enrollment;
  }

  // Submit lesson assessment
  async submitLessonAssessment(
    enrollmentId: string,
    lessonIndex: number,
    submitDto: SubmitLessonAssessmentDto,
  ): Promise<{
    enrollment: ModuleEnrollment;
    passed: boolean;
    score: number;
    results: any[];
  }> {
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const module = enrollment.moduleId as any;

    // Validate lesson index
    if (lessonIndex >= module.lessons.length) {
      throw new NotFoundException('Lesson not found');
    }

    const lesson = module.lessons[lessonIndex];
    if (!lesson.assessment) {
      throw new BadRequestException('This lesson has no assessment');
    }

    const lessonProgress = enrollment.lessonProgress.find(
      (lp) => lp.lessonIndex === lessonIndex,
    );

    if (!lessonProgress) {
      throw new NotFoundException('Lesson progress not found');
    }

    // Check attempt limit
    if (
      lesson.assessment.maxAttempts > 0 &&
      lessonProgress.assessmentAttempts >= lesson.assessment.maxAttempts
    ) {
      throw new BadRequestException('Maximum attempts reached for this lesson assessment');
    }

    // Grade assessment
    const { score, results, passed } = this.gradeAssessment(
      lesson.assessment.questions,
      submitDto.answers,
      lesson.assessment.passingScore,
    );

    // Update lesson progress
    lessonProgress.assessmentAttempts++;
    lessonProgress.lastScore = score;
    lessonProgress.assessmentPassed = passed;

    // If passed, mark lesson as completed
    if (passed && !lessonProgress.isCompleted) {
      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = new Date();
      enrollment.completedLessons++;

      // Update overall progress
      enrollment.progress = Math.round(
        (enrollment.completedLessons / enrollment.totalLessons) * 100,
      );

      // Clear module-repeat block when all lessons re-completed after a forced repeat
      if (
        enrollment.requiresModuleRepeat &&
        enrollment.completedLessons >= enrollment.totalLessons
      ) {
        enrollment.requiresModuleRepeat = false;
      }
    }

    enrollment.lastAccessedLesson = lessonIndex;
    enrollment.lastAccessedAt = new Date();

    await enrollment.save();

    return {
      enrollment,
      passed,
      score,
      results,
    };
  }

  // Submit final assessment
  async submitFinalAssessment(
    enrollmentId: string,
    submitDto: SubmitFinalAssessmentDto,
  ): Promise<{
    enrollment: ModuleEnrollment;
    passed: boolean;
    score: number;
    results: any[];
    levelUnlocked?: string;
    certificate?: any;
  }> {
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const module = enrollment.moduleId as any;

    if (!module.finalAssessment) {
      throw new BadRequestException('Module has no final assessment');
    }

    // Block if student must repeat the module before retaking
    if (enrollment.requiresModuleRepeat) {
      throw new BadRequestException(
        'You have reached the maximum number of attempts. You must review and complete the module again before reattempting the final assessment.',
      );
    }

    // Check if all lessons are completed
    if (enrollment.completedLessons < enrollment.totalLessons) {
      throw new BadRequestException(
        'Complete all lessons before taking the final assessment.',
      );
    }

    // Block if already at max attempts (should be reset after module repeat, but guard anyway)
    const maxAttempts = module.finalAssessment.maxAttempts ?? 3;
    if (maxAttempts > 0 && enrollment.finalAssessmentAttempts >= maxAttempts) {
      throw new BadRequestException(
        'You have reached the maximum number of attempts. You must review and complete the module again before reattempting the final assessment.',
      );
    }

    // Check if any question is essay-type (requires manual grading)
    const hasEssayQuestions = module.finalAssessment.questions.some(
      (q: any) => q.type === 'essay',
    );

    if (hasEssayQuestions) {
      // Store the answers for instructor review
      const results = module.finalAssessment.questions.map((q: any, i: number) => {
        const answer = submitDto.answers.find((a: any) => a.questionIndex === i);
        return {
          questionIndex: i,
          questionText: q.text,
          questionType: q.type,
          studentAnswer: answer?.answer || '',
          maxPoints: q.points,
          pointsEarned: 0,
          isCorrect: false,
        };
      });

      enrollment.finalAssessmentAttempts++;
      enrollment.finalAssessmentResults = results as any;
      enrollment.pendingInstructorReview = true;
      enrollment.essaySubmittedAt = new Date();

      await enrollment.save();

      // Notify instructor(s) via email
      const student = await this.userModel.findById(enrollment.studentId);
      const studentName = student
        ? `${student.firstName} ${student.lastName}`.trim()
        : 'Student';

      const instructors = await this.userModel.find({
        _id: { $in: module.instructorIds || [] },
      });

      for (const instructor of instructors) {
        if (!instructor.email) continue;
        const instructorName = `${instructor.firstName} ${instructor.lastName}`.trim();
        await this.emailService.sendEssaySubmissionNotificationToInstructor(
          instructor.email,
          instructorName,
          studentName,
          module.title,
          enrollment._id.toString(),
        ).catch(() => {});

        // Dashboard notification for instructor
        await this.notificationsService.createNotification(
          instructor._id.toString(),
          NotificationType.ESSAY_SUBMITTED,
          'Essay Assessment Submitted',
          `${studentName} submitted an essay assessment for "${module.title}" and is awaiting your review.`,
          undefined,
          enrollment._id.toString(),
        );
      }

      return {
        enrollment,
        passed: false,
        score: 0,
        results,
        status: 'pending_review',
        message: 'Essay submitted successfully. Awaiting instructor grading.',
      } as any;
    }

    // Auto-grade (no essay questions)
    const { score, results, passed } = this.gradeAssessment(
      module.finalAssessment.questions,
      submitDto.answers,
      module.finalAssessment.passingScore,
    );

    enrollment.finalAssessmentAttempts++;
    enrollment.finalAssessmentScore = score;
    enrollment.finalAssessmentPassed = passed;
    enrollment.finalAssessmentResults = results;

    let levelUnlocked: string | undefined;
    let certificate: any;
    let requiresModuleRepeat = false;
    let remainingAttempts: number | undefined;
    let message: string;

    if (passed) {
      // ── PASS ──────────────────────────────────────────────────────────────
      message = 'Congratulations! You passed the final assessment.';
      enrollment.isCompleted = true;
      enrollment.completedAt = new Date();
      enrollment.certificateEarned = true;
      enrollment.certificateIssuedAt = new Date();

      // Update level progression
      const progressionResult = await this.progressionService.onModuleCompleted(
        enrollment.studentId.toString(),
        module._id.toString(),
      );
      levelUnlocked = progressionResult.levelUnlocked;

      // Generate certificate record
      certificate = await this.generateCertificate(enrollment, module, score);

      // Dashboard notifications
      const student = await this.userModel.findById(enrollment.studentId);
      if (student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.CERTIFICATE_EARNED,
          'Certificate Earned!',
          `Congratulations! You passed "${module.title}" and earned your certificate.`,
          undefined,
          certificate?._id?.toString(),
        );
      }
      if (levelUnlocked && student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.LEVEL_UNLOCKED,
          'New Level Unlocked!',
          `You have unlocked the ${levelUnlocked} level. Keep learning!`,
        );
      }
    } else {
      // ── FAIL ──────────────────────────────────────────────────────────────
      const attemptsUsed = enrollment.finalAssessmentAttempts;

      if (maxAttempts > 0 && attemptsUsed >= maxAttempts) {
        // ── Max attempts exhausted → force module repeat ───────────────────
        requiresModuleRepeat = true;
        enrollment.requiresModuleRepeat = true;
        enrollment.moduleRepeatCount = (enrollment.moduleRepeatCount || 0) + 1;

        // Reset all lesson progress so student must redo the module
        enrollment.lessonProgress = enrollment.lessonProgress.map((lp) => ({
          ...lp,
          isCompleted: false,
          completedAt: undefined,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
        })) as any;
        enrollment.completedLessons = 0;
        enrollment.progress = 0;
        // Reset attempts — they get a fresh set after completing the module
        enrollment.finalAssessmentAttempts = 0;

        message =
          'You have reached the maximum number of attempts. You must review and complete the module again before reattempting the final assessment.';
      } else {
        // ── Still has attempts remaining ───────────────────────────────────
        remainingAttempts =
          maxAttempts > 0 ? maxAttempts - attemptsUsed : undefined;

        message =
          remainingAttempts !== undefined
            ? `You did not pass. You may attempt the assessment again. Remaining attempts: ${remainingAttempts}.`
            : 'You did not pass. You may attempt the assessment again.';
      }
    }

    await enrollment.save();

    return {
      enrollment,
      passed,
      score,
      results,
      levelUnlocked,
      certificate,
      requiresModuleRepeat,
      remainingAttempts,
      message,
    } as any;
  }

  // Generate certificate record
  private async generateCertificate(
    enrollment: ModuleEnrollment,
    module: any,
    score: number,
  ): Promise<ModuleCertificate> {
    const student = await this.userModel.findById(enrollment.studentId);
    const category = await this.categoryModel.findById(module.categoryId);
    const instructor = await this.userModel.findById(module.instructorIds[0]);

    const certificateNumber = `MC-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const publicId = crypto.randomUUID();

    const certificate = new this.certificateModel({
      studentId: enrollment.studentId,
      moduleId: module._id,
      enrollmentId: enrollment._id,
      studentName: `${student?.firstName || ''} ${student?.lastName || ''}`.trim() || 'Student',
      moduleName: module.title,
      moduleLevel: module.level,
      categoryName: category?.name || 'General',
      scoreAchieved: score,
      instructorName: instructor
        ? `${instructor.firstName || ''} ${instructor.lastName || ''}`.trim()
        : 'Instructor',
      issuedDate: new Date(),
      certificateNumber,
      publicId,
    });

    await certificate.save();

    // Update enrollment with certificate public ID
    enrollment.certificatePublicId = publicId;

    return certificate;
  }

  // Grade essay assessment (instructor marks pass/fail)
  async gradeEssayAssessment(
    enrollmentId: string,
    instructorId: string,
    pass: boolean,
    feedback: string,
    score?: number,
  ): Promise<{
    enrollment: ModuleEnrollment;
    passed: boolean;
    levelUnlocked?: string;
    certificate?: any;
  }> {
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');

    if (!enrollment) throw new NotFoundException('Enrollment not found');

    if (!enrollment.pendingInstructorReview) {
      throw new BadRequestException(
        'This enrollment does not have a pending essay for review',
      );
    }

    const module = enrollment.moduleId as any;

    // Verify instructor is assigned to this module
    const isAssigned = module.instructorIds?.some(
      (id: any) => id.toString() === instructorId,
    );
    if (!isAssigned) {
      throw new ForbiddenException(
        'You are not assigned as instructor for this module',
      );
    }

    const finalScore = score ?? (pass ? 100 : 0);

    enrollment.finalAssessmentPassed = pass;
    enrollment.finalAssessmentScore = finalScore;
    enrollment.pendingInstructorReview = false;

    // Update results with instructor feedback
    if (enrollment.finalAssessmentResults) {
      enrollment.finalAssessmentResults = enrollment.finalAssessmentResults.map(
        (r: any) => ({
          ...r,
          instructorFeedback: feedback,
          gradedAt: new Date(),
          gradedBy: new Types.ObjectId(instructorId),
          isCorrect: pass,
          pointsEarned: pass ? r.maxPoints : 0,
        }),
      ) as any;
    }

    let levelUnlocked: string | undefined;
    let certificate: any;

    const student = await this.userModel.findById(enrollment.studentId);
    const studentName = student
      ? `${student.firstName} ${student.lastName}`.trim()
      : 'Student';

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (pass) {
      enrollment.isCompleted = true;
      enrollment.completedAt = new Date();
      enrollment.certificateEarned = true;
      enrollment.certificateIssuedAt = new Date();

      // Update level progression
      const progressionResult = await this.progressionService.onModuleCompleted(
        enrollment.studentId.toString(),
        module._id.toString(),
      );
      levelUnlocked = progressionResult.levelUnlocked;

      // Generate certificate
      certificate = await this.generateCertificate(enrollment, module, finalScore);

      const certUrl = certificate?.publicId
        ? `${frontendUrl}/certificates/${certificate.publicId}`
        : `${frontendUrl}/student/certificates`;

      // Email student — passed
      if (student?.email) {
        await this.emailService.sendEssayGradingResultToStudent(
          student.email,
          studentName,
          module.title,
          true,
          feedback,
          certUrl,
        ).catch(() => {});
      }

      // Dashboard notifications for student
      if (student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.ESSAY_GRADED,
          'Essay Assessment Passed!',
          `Your essay for "${module.title}" has been reviewed. You passed! Your certificate is ready.`,
          certUrl,
          certificate?._id?.toString(),
        );

        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.CERTIFICATE_EARNED,
          'Certificate Earned!',
          `Congratulations! You earned a certificate for completing "${module.title}".`,
          certUrl,
          certificate?._id?.toString(),
        );
      }

      if (levelUnlocked && student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.LEVEL_UNLOCKED,
          'New Level Unlocked!',
          `You have unlocked the ${levelUnlocked} level. Keep going!`,
        );
      }
    } else {
      // ── Essay FAIL path ──────────────────────────────────────────────────
      const maxAttempts = module.finalAssessment?.maxAttempts ?? 3;
      let requiresModuleRepeat = false;

      if (maxAttempts > 0 && enrollment.finalAssessmentAttempts >= maxAttempts) {
        // Max attempts exhausted — force module repeat
        requiresModuleRepeat = true;
        enrollment.requiresModuleRepeat = true;
        enrollment.moduleRepeatCount = (enrollment.moduleRepeatCount || 0) + 1;

        enrollment.lessonProgress = enrollment.lessonProgress.map((lp) => ({
          ...lp,
          isCompleted: false,
          completedAt: undefined,
          assessmentAttempts: 0,
          assessmentPassed: false,
          lastScore: 0,
        })) as any;
        enrollment.completedLessons = 0;
        enrollment.progress = 0;
        enrollment.finalAssessmentAttempts = 0;
      }

      // Email student — failed
      if (student?.email) {
        await this.emailService.sendEssayGradingResultToStudent(
          student.email,
          studentName,
          module.title,
          false,
          feedback,
        ).catch(() => {});
      }

      const failMessage = requiresModuleRepeat
        ? `Your essay for "${module.title}" did not pass. You have reached the maximum number of attempts. You must review and complete the module again before reattempting.`
        : `Your essay for "${module.title}" has been reviewed. Please check the feedback and try again.`;

      if (student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.ESSAY_GRADED,
          requiresModuleRepeat ? 'Essay Assessment — Module Repeat Required' : 'Essay Assessment Reviewed',
          failMessage,
        );
      }
    }

    await enrollment.save();

    return { enrollment, passed: pass, levelUnlocked, certificate };
  }

  // Grade assessment (auto-grade MC and TF)
  private gradeAssessment(
    questions: any[],
    answers: any[],
    passingScore: number,
  ): { score: number; results: any[]; passed: boolean } {
    let totalPoints = 0;
    let earnedPoints = 0;
    const results: any[] = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const answer = answers.find((a) => a.questionIndex === i);

      totalPoints += question.points;

      const result: any = {
        questionIndex: i,
        questionText: question.text,
        questionType: question.type,
        studentAnswer: answer?.answer || '',
        maxPoints: question.points,
        pointsEarned: 0,
      };

      // Auto-grade multiple choice and true-false
      if (
        question.type === 'multiple-choice' ||
        question.type === 'true-false'
      ) {
        result.correctAnswer = question.correctAnswer;
        const isCorrect =
          answer?.answer?.toLowerCase() ===
          question.correctAnswer?.toLowerCase();
        result.isCorrect = isCorrect;
        result.pointsEarned = isCorrect ? question.points : 0;
        result.explanation = question.explanation;
      } else if (question.type === 'essay') {
        // Mark for manual grading or AI grading
        result.isCorrect = false;
        result.pointsEarned = 0;
      }

      earnedPoints += result.pointsEarned;
      results.push(result);
    }

    const score =
      totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const passed = score >= passingScore;

    return { score, results, passed };
  }
}
