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
import { LessonCompletion } from '../schemas/lesson-completion.schema';
import { Module, ModuleStatus } from '../schemas/module.schema';
import { ModuleCertificate } from '../schemas/module-certificate.schema';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import {
  SubmitFinalAssessmentDto,
  SubmitLessonAssessmentDto,
} from './dto/submit-assessment.dto';
import { ProgressionService } from '../progression/progression.service';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../schemas/notification.schema';

@Injectable()
export class ModuleEnrollmentsService {
  constructor(
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(LessonCompletion.name)
    private lessonCompletionModel: Model<LessonCompletion>,
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
  ): Promise<
    | ModuleEnrollment
    | {
        requiresPayment: boolean;
        categoryId: string;
        price: number;
        categoryName: string;
      }
  > {
    const module = await this.moduleModel
      .findById(moduleId)
      .populate('categoryId');
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

        // FREE category → fellow-only access; non-fellows are blocked entirely (no payment option)
        if (category.accessType === 'free') {
          if (!hasFellowAccess) {
            throw new ForbiddenException(
              'This module is only accessible to assigned fellows. Please contact the admin to get access.',
            );
          }
          // Fellow → fall through to enroll for free
        }

        // RESTRICTED category → fellows assigned to this category get free access;
        // everyone else (including fellows assigned to other categories) must pay
        else if (category.accessType === 'restricted') {
          if (!hasFellowAccess && !hasPurchasedAccess) {
            return {
              requiresPayment: true,
              categoryId: category._id.toString(),
              price: category.price,
              categoryName: category.name,
            };
          }
          // Fellow assigned here, or already purchased → fall through to enroll
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
        const levelLabel =
          module.level === 'intermediate' ? 'Beginner' : 'Intermediate';
        throw new ForbiddenException(
          `You must complete and pass all ${levelLabel} modules before accessing ${module.level} content.`,
        );
      }
    }

    // ── Sequential order gate ─────────────────────────────────────────────────
    // If a module has order > 1, the student must have completed the previous
    // module (same category, order - 1) before enrolling.
    if (category && (module as any).order && (module as any).order > 1) {
      const prevModule = await this.moduleModel
        .findOne({
          categoryId: category._id,
          order: (module as any).order - 1,
          isActive: true,
        })
        .select('_id title order')
        .lean();

      if (prevModule) {
        const prevEnrollment = await this.enrollmentModel
          .findOne({
            studentId: new Types.ObjectId(studentId),
            moduleId: prevModule._id,
            isCompleted: true,
          })
          .lean();

        if (!prevEnrollment) {
          throw new ForbiddenException(
            `You must complete "${(prevModule as any).title || `Module ${(module as any).order - 1}`}" before enrolling in this module.`,
          );
        }
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

    // Resolve lessons — prefer direct lessons[], fall back to topics
    const allLessons =
      module.lessons && module.lessons.length > 0
        ? [...module.lessons].sort(
            (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0),
          )
        : (module.topics || []).flatMap((t: any) => t.lessons || []);

    // Create enrollment
    enrollment = new this.enrollmentModel({
      studentId: new Types.ObjectId(studentId),
      moduleId: new Types.ObjectId(moduleId),
      totalLessons: allLessons.length,
      lessonProgress: allLessons.map((_: any, index: number) => ({
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
    const enrollments = await this.enrollmentModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .populate({
        path: 'moduleId',
        select:
          'title description level bannerUrl categoryId duration lessons topics isContentFinalized finalAssessment order',
        populate: { path: 'categoryId', select: 'name' },
      })
      .sort({ createdAt: -1 })
      .lean();

    const certificates = await this.certificateModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .select('enrollmentId publicId')
      .lean();

    const certificatePublicIdByEnrollmentId = new Map<string, string>(
      certificates
        .filter((certificate: any) => certificate?.enrollmentId)
        .map((certificate: any) => [
          certificate.enrollmentId.toString(),
          certificate.publicId,
        ]),
    );

    return enrollments.map((enrollment: any) =>
      this.normalizeEnrollmentSummary(
        enrollment,
        certificatePublicIdByEnrollmentId,
      ),
    );
  }

  // Get enrollment details
  async getEnrollmentById(enrollmentId: string): Promise<ModuleEnrollment> {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }
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

  // ── Shared helper: resolve sorted lessons from a populated module ──────────
  private getSortedLessons(module: any): any[] {
    if (module.lessons && module.lessons.length > 0) {
      return [...module.lessons].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    }
    return (module.topics || []).flatMap((t: any) => t.lessons || []);
  }

  private normalizeEnrollmentSummary(
    enrollment: any,
    certificatePublicIdByEnrollmentId: Map<string, string>,
  ) {
    const module = enrollment.moduleId as any;
    const sortedLessons = this.getSortedLessons(module);

    // Derive total lessons from the actual module structure instead of the enrollment snapshot
    const totalLessons = sortedLessons.length > 0 ? sortedLessons.length : (enrollment.totalLessons || 0);

    const completedLessonsBase = Array.isArray(enrollment.lessonProgress)
      ? enrollment.lessonProgress.filter((lp: any) => lp?.isCompleted).length
      : enrollment.completedLessons || 0;

    const certificatePublicId =
      certificatePublicIdByEnrollmentId.get(enrollment._id.toString()) ?? null;

    // Ground truth: Use the isCompleted flag set during assessment passing
    const isCompleted = !!enrollment.isCompleted;

    const completedLessons =
      isCompleted && totalLessons > 0
        ? totalLessons
        : Math.min(completedLessonsBase, totalLessons);

    const progress = isCompleted
      ? 100
      : totalLessons > 0
        ? Math.min(100, Math.round((completedLessons / totalLessons) * 100))
        : 0;

    return {
      ...enrollment,
      totalLessons,
      completedLessons,
      progress,
      isCompleted,
      certificateEarned: !!certificatePublicId,
      certificatePublicId,
    };
  }

  // ── NEW: Get fresh, server-derived enrollment progress ────────────────────
  /**
   * Single source of truth for the frontend.
   * Derives every UI-visible state from the database — never from a cached flag.
   *
   * Returns:
   *  lessonStates[]   — per-lesson { isCompleted, isAccessible, isLocked }
   *  nextLessonIndex  — lowest-index incomplete & accessible lesson
   *  completedLessons / totalLessons / progress (%)
   */
  async getEnrollmentProgress(enrollmentId: string, studentId: string) {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }

    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (String(enrollment.studentId) !== String(studentId)) {
      throw new NotFoundException('Enrollment not found');
    }

    const module = enrollment.moduleId as any;
    const lessons = this.getSortedLessons(module);
    const totalLessons = lessons.length;
    const generation = enrollment.moduleRepeatGeneration ?? 0;

    // Fetch all completions for the current repeat generation — O(lessons) query
    const completionDocs = await this.lessonCompletionModel.find({
      enrollmentId: new Types.ObjectId(enrollmentId),
      repeatGeneration: generation,
    });

    const completedSet = new Map<number, Date>(
      completionDocs.map((c) => [c.lessonIndex, c.completedAt]),
    );

    // Build per-lesson accessibility state (sequential: each lesson unlocks
    // when the previous one is completed and, if it had a quiz, passed it).
    const lessonStates = lessons.map((lesson: any, i: number) => {
      const lp = enrollment.lessonProgress.find((lp) => lp.lessonIndex === i);
      // Primary truth: lessonProgress.isCompleted (mutable current state).
      // Fallback: legacy/new completion docs for older enrollments.
      const isCompleted = lp ? !!lp.isCompleted : completedSet.has(i);
      const hasQuiz = (lesson.assessmentQuiz?.length ?? 0) > 0;
      const assessmentPassed = lp?.assessmentPassed ?? false;

      let isAccessible: boolean;
      if (i === 0) {
        isAccessible = true;
      } else {
        const prevCompleted = completedSet.has(i - 1);
        const prevLesson = lessons[i - 1];
        const prevHasQuiz = (prevLesson?.assessmentQuiz?.length ?? 0) > 0;
        const prevLp = enrollment.lessonProgress.find((lp) => lp.lessonIndex === i - 1);
        const prevAssessmentPassed = prevLp?.assessmentPassed ?? false;
        isAccessible = prevHasQuiz ? prevAssessmentPassed : prevCompleted;
      }

      const lastAnswers = lp?.lastAnswers ?? null;
      console.log(
        `[getProgress] Lesson ${i} | completed=${isCompleted} | assessmentPassed=${assessmentPassed} | lastAccessedSlide=${lp?.lastAccessedSlide ?? 0} | hasLastAnswers=${!!lastAnswers}`,
      );

      return {
        lessonIndex: i,
        title: lesson.title || `Lesson ${i + 1}`,
        isCompleted,
        isAccessible,
        isLocked: !isCompleted && !isAccessible,
        completedAt: lp?.completedAt ?? completedSet.get(i) ?? null,
        hasQuiz,
        assessmentPassed,
        assessmentAttempts: lp?.assessmentAttempts ?? 0,
        lastScore: lp?.lastScore ?? 0,
        lastAccessedSlide: lp?.lastAccessedSlide ?? 0,
        lastAnswers,
      };
    });

    const completedLessons = lessonStates.filter((ls) => ls.isCompleted).length;
    const allLessonsCompleted =
      totalLessons > 0 && completedLessons >= totalLessons && !enrollment.requiresModuleRepeat;
    const hasFinalAssessment = ((module as any)?.finalAssessment?.questions?.length ?? 0) > 0;

    // Modules without a final assessment are complete when all lessons are complete.
    // This also repairs older enrollments that reached 100% before this rule existed.
    let isCompleted = !!enrollment.isCompleted;
    if (allLessonsCompleted && !hasFinalAssessment && !isCompleted) {
      await this.enrollmentModel.updateOne(
        { _id: enrollment._id },
        {
          $set: {
            isCompleted: true,
            completedAt: new Date(),
            completedLessons,
            progress: 100,
            certificateEarned: false,
          },
        },
      );
      await this.progressionService.onModuleCompleted(
        enrollment.studentId.toString(),
        module._id.toString(),
      );
      isCompleted = true;
    }

    // Force 100% progress if the module is marked as completed
    const progress = isCompleted
      ? 100
      : totalLessons > 0 ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : 0;

    // Next lesson = lowest-index that is accessible but not yet completed
    let nextLessonIndex: number | null = null;
    for (const ls of lessonStates) {
      if (!ls.isCompleted && ls.isAccessible) {
        nextLessonIndex = ls.lessonIndex;
        break;
      }
    }

    const savedLessonIndex =
      typeof enrollment.lastAccessedLesson === 'number'
        ? enrollment.lastAccessedLesson
        : null;
    const savedLessonState =
      savedLessonIndex !== null ? lessonStates[savedLessonIndex] : null;
    const currentLessonIndex =
      savedLessonState && (savedLessonState.isAccessible || savedLessonState.isCompleted)
        ? savedLessonIndex
        : nextLessonIndex;
    const currentSlideIndex =
      currentLessonIndex !== null
        ? lessonStates[currentLessonIndex]?.lastAccessedSlide ?? 0
        : 0;

    console.log(
      `[getProgress] Returning resume position | enrollmentId=${enrollmentId} | lastAccessedLesson=${enrollment.lastAccessedLesson} | currentLessonIndex=${currentLessonIndex} | currentSlideIndex=${currentSlideIndex} | nextLessonIndex=${nextLessonIndex} | completedLessons=${completedLessons}/${totalLessons}`,
    );

    return {
      enrollmentId: enrollment._id,
      moduleId: (enrollment.moduleId as any)._id ?? enrollment.moduleId,
      totalLessons,
      completedLessons,
      progress,
      lessonStates,
      nextLessonIndex,
      currentLessonIndex,
      currentSlideIndex,
      allLessonsCompleted,
      requiresModuleRepeat: enrollment.requiresModuleRepeat ?? false,
      moduleRepeatGeneration: generation,
      finalAssessmentPassed: enrollment.finalAssessmentPassed,
      finalAssessmentAttempts: enrollment.finalAssessmentAttempts,
      assessmentCooldownUntil: enrollment.assessmentCooldownUntil ?? null,
      isCompleted,
      certificateEarned: enrollment.certificateEarned,
      certificatePublicId: enrollment.certificatePublicId ?? null,
      // true = instructor finished adding all lessons; Final Assessment is now unlockable
      isContentFinalized: (module as any).isContentFinalized ?? false,
    };
  }

  // ── NEW: Idempotent lesson completion ──────────────────────────────────────
  /**
   * Marks a lesson as completed for the student's current repeat generation.
   *
   * Properties:
   *  - Idempotent: calling it twice for the same lesson is safe (upsert).
   *  - Append-only: never sets any flag to false, never overwrites a completion.
   *  - Atomic counter update: uses $inc / $set on specific fields — never saves
   *    the full enrollment document, so it cannot race with trackSlideProgress.
   *
   * Returns the fresh progress state (same shape as getEnrollmentProgress).
   */
  async markLessonCompleted(enrollmentId: string, lessonIndex: number, studentId: string) {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }

    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (String(enrollment.studentId) !== String(studentId)) {
      throw new NotFoundException('Enrollment not found');
    }

    const module = enrollment.moduleId as any;
    const lessons = this.getSortedLessons(module);
    const totalLessons = lessons.length;

    if (lessonIndex < 0 || lessonIndex >= totalLessons) {
      throw new BadRequestException('Lesson index out of range');
    }

    const generation = enrollment.moduleRepeatGeneration ?? 0;

    // Upsert — creates the record only if it doesn't exist yet.
    // $setOnInsert means: if the document is being INSERTED (not updated), apply these fields.
    // If the document already existed, the operation is a no-op — nothing changes.
    const upsertResult = await this.lessonCompletionModel.findOneAndUpdate(
      { enrollmentId: new Types.ObjectId(enrollmentId), lessonIndex, repeatGeneration: generation },
      {
        $setOnInsert: {
          enrollmentId: new Types.ObjectId(enrollmentId),
          studentId: new Types.ObjectId(studentId),
          moduleId: (enrollment.moduleId as any)._id ?? enrollment.moduleId,
          lessonIndex,
          repeatGeneration: generation,
          completedAt: new Date(),
        },
      },
      { upsert: true, new: false }, // new: false → returns null when newly inserted
    );

    const wasNewlyCompleted = upsertResult === null;

    const lpIndex = enrollment.lessonProgress.findIndex(
      (lp) => lp.lessonIndex === lessonIndex,
    );
    let shouldUpdateProgressionForModuleCompletion = false;

    if (wasNewlyCompleted) {
      // Count completions for this generation to get the authoritative number
      const completedCount = await this.lessonCompletionModel.countDocuments({
        enrollmentId: new Types.ObjectId(enrollmentId),
        repeatGeneration: generation,
      });

      const newProgress =
        totalLessons > 0 ? Math.min(100, Math.round((completedCount / totalLessons) * 100)) : 0;

      // Atomic field-level update — never touches the rest of the document
      const atomicUpdate: Record<string, any> = {
        $set: {
          completedLessons: completedCount,
          progress: newProgress,
          lastAccessedLesson: lessonIndex,
          lastAccessedAt: new Date(),
        },
      };

      // Keep lessonProgress in sync with completion docs so the progress endpoint
      // and the learning UI always reflect the same completion state.
      if (lpIndex >= 0) {
        atomicUpdate.$set[`lessonProgress.${lpIndex}.isCompleted`] = true;
        atomicUpdate.$set[`lessonProgress.${lpIndex}.completedAt`] = new Date();
      }

      // If student has completed all lessons during a module repeat, clear the block
      if (enrollment.requiresModuleRepeat && completedCount >= totalLessons) {
        atomicUpdate.$set.requiresModuleRepeat = false;
        atomicUpdate.$set.finalAssessmentAttempts = 0;
      }

      // Auto-complete: if all lessons done and the module has no final assessment
      // (or the assessment has no questions), mark enrollment as completed now.
      if (completedCount >= totalLessons) {
        const mod = enrollment.moduleId as any;
        const hasAssessment = (mod?.finalAssessment?.questions?.length ?? 0) > 0;
        if (!hasAssessment && !enrollment.isCompleted) {
          atomicUpdate.$set.isCompleted = true;
          atomicUpdate.$set.completedAt = new Date();
          atomicUpdate.$set.certificateEarned = false; // no cert without final assessment
          shouldUpdateProgressionForModuleCompletion = true;
          console.log(`[markLessonCompleted] Auto-completing enrollment ${enrollmentId} — no final assessment`);
        }
      }

      await this.enrollmentModel.updateOne({ _id: enrollmentId }, atomicUpdate);

      if (shouldUpdateProgressionForModuleCompletion) {
        await this.progressionService.onModuleCompleted(
          enrollment.studentId.toString(),
          ((enrollment.moduleId as any)._id ?? enrollment.moduleId).toString(),
        );
      }
    } else if (lpIndex >= 0) {
      // Backfill/sync for old enrollments where completion doc exists but
      // lessonProgress flag was not previously updated.
      await this.enrollmentModel.updateOne(
        { _id: enrollmentId },
        {
          $set: {
            [`lessonProgress.${lpIndex}.isCompleted`]: true,
            [`lessonProgress.${lpIndex}.completedAt`]: new Date(),
            lastAccessedLesson: lessonIndex,
            lastAccessedAt: new Date(),
          },
        },
      );
    }

    // Always return fresh, server-derived progress (never a stale in-memory snapshot)
    return this.getEnrollmentProgress(enrollmentId, studentId);
  }

  // ── Track slide progress (engagement: time + scroll) ──────────────────────
  async trackSlideProgress(
    enrollmentId: string,
    lessonIndex: number,
    slideIndex: number,
    timeSpent: number,
    scrolledToBottom: boolean,
  ): Promise<{
    enrollment: ModuleEnrollment;
    slideCompleted: boolean;
    lessonUnlocked: boolean;
    lessonAutoCompleted?: boolean;
  }> {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }

    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const module = enrollment.moduleId as any;

    // Resolve lessons
    const allLessons: any[] =
      module.lessons && module.lessons.length > 0
        ? [...module.lessons].sort(
            (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0),
          )
        : (module.topics || []).flatMap((t: any) => t.lessons || []);

    if (lessonIndex >= allLessons.length)
      throw new NotFoundException('Lesson not found');

    const lesson = allLessons[lessonIndex];
    const slides = lesson.slides || [];

    if (slideIndex >= slides.length && slides.length > 0) {
      throw new NotFoundException('Slide not found');
    }

    const slide = slides[slideIndex] || null;
    const minTime = slide?.minViewingTime ?? 15;
    const needsScroll = slide?.scrollTrackingEnabled ?? false;
    const hasQuiz = (lesson?.assessmentQuiz?.length ?? 0) > 0;

    // Find or create lesson progress entry
    let lessonProgress = enrollment.lessonProgress.find(
      (lp) => lp.lessonIndex === lessonIndex,
    );
    if (!lessonProgress) {
      // If missing, this is an older enrollment — add it
      (enrollment.lessonProgress as any).push({
        lessonIndex,
        isCompleted: false,
        slideProgress: [],
        completedSlides: 0,
        lastAccessedSlide: 0,
        assessmentAttempts: 0,
        assessmentPassed: false,
        lastScore: 0,
      });
      lessonProgress = enrollment.lessonProgress.find(
        (lp) => lp.lessonIndex === lessonIndex,
      )!;
    }

    // Find or create slide progress entry
    if (!Array.isArray(lessonProgress.slideProgress)) {
      (lessonProgress as any).slideProgress = [];
    }

    let slideProgress = lessonProgress.slideProgress.find(
      (sp) => sp.slideIndex === slideIndex,
    );
    if (!slideProgress) {
      (lessonProgress.slideProgress as any).push({
        slideIndex,
        isCompleted: false,
        timeSpent: 0,
        scrolledToBottom: false,
      });
      slideProgress = lessonProgress.slideProgress.find(
        (sp) => sp.slideIndex === slideIndex,
      )!;
    }

    // Accumulate time
    slideProgress.timeSpent = (slideProgress.timeSpent || 0) + timeSpent;
    if (scrolledToBottom) slideProgress.scrolledToBottom = true;

    // Check if slide is now complete
    const timeRequirementMet = slideProgress.timeSpent >= minTime;
    const scrollRequirementMet = !needsScroll || slideProgress.scrolledToBottom;
    const slideCompleted = timeRequirementMet && scrollRequirementMet;

    if (slideCompleted && !slideProgress.isCompleted) {
      slideProgress.isCompleted = true;
      slideProgress.completedAt = new Date();
    }

    // Check if all slides in this lesson are done (lessonUnlocked = ready for assessment)
    const totalSlides = slides.length;
    const completedSlides = lessonProgress.slideProgress.filter(
      (sp) => sp.isCompleted,
    ).length;
    const lessonUnlocked = totalSlides === 0 || completedSlides >= totalSlides;

    // Use atomic update for slide progress so this never overwrites lessonProgress.isCompleted
    // (which completeLesson sets). A full enrollment.save() would stomp that flag when this
    // function loaded a stale copy of the document before completeLesson ran.
    const slideProgressFilter = { _id: enrollment._id };
    const lpIndex = enrollment.lessonProgress.findIndex(
      (lp) => lp.lessonIndex === lessonIndex,
    );
    const spIndex = enrollment.lessonProgress[lpIndex].slideProgress.findIndex(
      (sp) => sp.slideIndex === slideIndex,
    );

    const setFields: Record<string, any> = {
      lastAccessedAt: new Date(),
      lastAccessedLesson: lessonIndex,
      [`lessonProgress.${lpIndex}.lastAccessedSlide`]: slideIndex,
      [`lessonProgress.${lpIndex}.slideProgress.${spIndex}.timeSpent`]: slideProgress.timeSpent,
      [`lessonProgress.${lpIndex}.slideProgress.${spIndex}.scrolledToBottom`]: slideProgress.scrolledToBottom,
    };

    if (slideCompleted && slideProgress.isCompleted) {
      setFields[`lessonProgress.${lpIndex}.slideProgress.${spIndex}.isCompleted`] = true;
      setFields[`lessonProgress.${lpIndex}.slideProgress.${spIndex}.completedAt`] = new Date();
      setFields[`lessonProgress.${lpIndex}.completedSlides`] = completedSlides;
    }

    let lessonAutoCompleted = false;
    if (lessonUnlocked && !hasQuiz && !lessonProgress.isCompleted) {
      lessonAutoCompleted = true;
      const completedAt = new Date();
      const generation = enrollment.moduleRepeatGeneration ?? 0;

      // Keep append-only completion records in sync for compatibility/migrations.
      await this.lessonCompletionModel.findOneAndUpdate(
        {
          enrollmentId: new Types.ObjectId(enrollmentId),
          lessonIndex,
          repeatGeneration: generation,
        },
        {
          $setOnInsert: {
            enrollmentId: new Types.ObjectId(enrollmentId),
            studentId: enrollment.studentId,
            moduleId: (enrollment.moduleId as any)._id ?? enrollment.moduleId,
            lessonIndex,
            repeatGeneration: generation,
            completedAt,
          },
        },
        { upsert: true, new: false },
      );

      // Sync mutable lessonProgress completion flag used by the progress endpoint.
      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = completedAt as any;
      setFields[`lessonProgress.${lpIndex}.isCompleted`] = true;
      setFields[`lessonProgress.${lpIndex}.completedAt`] = completedAt;

      const completedLessonsCount = enrollment.lessonProgress.filter((lp) => lp.isCompleted).length;
      const newProgress =
        enrollment.totalLessons > 0
          ? Math.min(100, Math.round((completedLessonsCount / enrollment.totalLessons) * 100))
          : 0;

      setFields.completedLessons = completedLessonsCount;
      setFields.progress = newProgress;
    }

    await this.enrollmentModel.updateOne(slideProgressFilter, { $set: setFields });

    return { enrollment, slideCompleted, lessonUnlocked, lessonAutoCompleted };
  }

  // Complete lesson
  async completeLesson(
    enrollmentId: string,
    lessonIndex: number,
  ): Promise<{
    enrollment: ModuleEnrollment;
    navigateTo: 'final_assessment' | 'next_lesson' | null;
    nextLessonIndex?: number;
  }> {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const module = enrollment.moduleId as any;

    const lessonProgress = enrollment.lessonProgress.find(
      (lp) => lp.lessonIndex === lessonIndex,
    );

    if (!lessonProgress) {
      console.error(`[completeLesson] lessonProgress not found for lessonIndex=${lessonIndex}`, {
        enrollmentId,
        availableLessonIndexes: enrollment.lessonProgress.map(lp => lp.lessonIndex),
        totalLessons: enrollment.totalLessons,
      });
      throw new NotFoundException('Lesson not found');
    }

    if (!lessonProgress.isCompleted) {
      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = new Date();

      // Mark all slides in this lesson as completed for proper sidebar display
      if (lessonProgress.slideProgress && lessonProgress.slideProgress.length > 0) {
        const now = new Date();
        lessonProgress.slideProgress.forEach((sp) => {
          if (!sp.isCompleted) {
            sp.isCompleted = true;
            sp.completedAt = now;
          }
        });
        lessonProgress.completedSlides = lessonProgress.slideProgress.length;
      }

      // Recompute from source of truth to avoid counter drift / race conditions
      enrollment.completedLessons = enrollment.lessonProgress.filter(
        (lp) => lp.isCompleted,
      ).length;
      enrollment.progress =
        enrollment.totalLessons > 0
          ? Math.min(
              100,
              Math.round(
                (enrollment.completedLessons / enrollment.totalLessons) * 100,
              ),
            )
          : 0;

      // If student completed all lessons after a forced module repeat,
      // clear the block and reset attempt counter so they get a fresh set.
      if (
        enrollment.requiresModuleRepeat &&
        enrollment.completedLessons >= enrollment.totalLessons
      ) {
        enrollment.requiresModuleRepeat = false;
        enrollment.finalAssessmentAttempts = 0;
      }

      enrollment.lastAccessedLesson = lessonIndex;
      enrollment.lastAccessedAt = new Date();

      await enrollment.save();
      console.log(`[completeLesson] Lesson ${lessonIndex} marked as completed`, { enrollmentId });
    } else {
      console.log(`[completeLesson] Lesson ${lessonIndex} already completed`, { enrollmentId });
    }

    // ── Navigation hint ───────────────────────────────────────────────────────
    // Tell the frontend where to go next so it can auto-navigate without a
    // manual click.
    let navigateTo: 'final_assessment' | 'next_lesson' | null = null;
    let nextLessonIndex: number | undefined;

    const allLessonsDone =
      enrollment.completedLessons >= enrollment.totalLessons &&
      !enrollment.requiresModuleRepeat;

    if (allLessonsDone && module?.finalAssessment) {
      navigateTo = 'final_assessment';
    } else if (!allLessonsDone) {
      // Find the lowest-index incomplete lesson after the current one
      const nextIncomplete = enrollment.lessonProgress
        .filter((lp) => !lp.isCompleted && lp.lessonIndex > lessonIndex)
        .sort((a, b) => a.lessonIndex - b.lessonIndex)[0];

      if (nextIncomplete) {
        navigateTo = 'next_lesson';
        nextLessonIndex = nextIncomplete.lessonIndex;
      }
    }

    return { enrollment, navigateTo, nextLessonIndex };
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
    navigateTo: 'final_assessment' | 'next_lesson' | null;
    nextLessonIndex?: number;
    lessonResetRequired: boolean;
    remainingAttempts?: number;
  }> {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }
    
    // Refresh enrollment to ensure latest changes are fetched from DB
    // (prevents race condition where assessment check happens before completion write)
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('moduleId');

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const module = enrollment.moduleId as any;

    // Resolve lessons — prefer direct lessons[], fall back to topics
    const allLessons: any[] =
      module.lessons && module.lessons.length > 0
        ? [...module.lessons].sort(
            (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0),
          )
        : (module.topics || []).flatMap((t: any) => t.lessons || []);

    if (lessonIndex >= allLessons.length) {
      throw new NotFoundException('Lesson not found');
    }

    const lesson = allLessons[lessonIndex];
    if (!lesson.assessmentQuiz || lesson.assessmentQuiz.length === 0) {
      throw new BadRequestException('This lesson has no assessment');
    }

    const lessonProgress = enrollment.lessonProgress.find(
      (lp) => lp.lessonIndex === lessonIndex,
    );

    if (!lessonProgress) {
      throw new NotFoundException('Lesson progress not found');
    }

    // Auto-complete the lesson if not already marked done.
    // This handles a race condition where the periodic slide-progress timer
    // (trackSlideProgress) saves a stale document after completeLesson has
    // already set isCompleted = true, overwriting it back to false.
    if (!lessonProgress.isCompleted) {
      lessonProgress.isCompleted = true;
      lessonProgress.completedAt = new Date();

      enrollment.completedLessons = enrollment.lessonProgress.filter(
        (lp) => lp.isCompleted,
      ).length;
      enrollment.progress =
        enrollment.totalLessons > 0
          ? Math.min(
              100,
              Math.round(
                (enrollment.completedLessons / enrollment.totalLessons) * 100,
              ),
            )
          : 0;
    }

    // Guard: assessment already passed — no re-submission needed
    if (lessonProgress.assessmentPassed) {
      throw new BadRequestException('You have already passed this assessment.');
    }

    const maxAttempts: number = lesson.quizMaxAttempts ?? 3;

    // Guard: attempts exhausted (safety net for stale data)
    if (maxAttempts > 0 && lessonProgress.assessmentAttempts >= maxAttempts) {
      throw new BadRequestException(
        'All attempts used. Please re-complete this lesson to unlock a new set of attempts.',
      );
    }

    // Normalise QuizQuestion fields — use .toObject() to get a plain JS object
    // (Mongoose subdocuments don't spread cleanly: arrays like `options` get lost with { ...q })
    const normalizedQuestions = (lesson.assessmentQuiz || []).map((q: any) => {
      const plain = typeof q.toObject === 'function' ? q.toObject() : { ...q };
      const answerKey =
        (plain.correctAnswer && plain.correctAnswer.toString().trim()) ||
        (plain.answer && plain.answer.toString().trim()) ||
        '';
      console.log(
        `[normalizeQ] Q index | type="${plain.type ?? 'MISSING'}" | answer="${plain.answer ?? 'MISSING'}" | answerKey="${answerKey}" | options:`,
        plain.options,
      );
      return { ...plain, text: plain.text || plain.question, correctAnswer: answerKey };
    });

    const { score, results, passed } = this.gradeAssessment(
      normalizedQuestions,
      submitDto.answers,
      lesson.quizPassingScore ?? 70,
    );

    lessonProgress.assessmentAttempts++;
    lessonProgress.lastScore = score;
    lessonProgress.assessmentPassed = passed;

    // Always persist the student's last submitted answers for quiz review mode.
    // On pass: these are the winning answers shown when revisiting the lesson.
    // On fail: these are available for debugging/review before retry.
    const answersMap: Record<string, string> = {};
    submitDto.answers.forEach((a) => {
      answersMap[String(a.questionIndex)] = String(a.answer);
    });
    lessonProgress.lastAnswers = answersMap;
    // Mixed (Object) fields aren't auto-tracked by Mongoose — must mark as modified
    enrollment.markModified('lessonProgress');
    console.log(
      `[submitLessonAssessment] Saved lastAnswers | lesson=${lessonIndex} | passed=${passed} | answersCount=${Object.keys(answersMap).length}`,
    );

    let lessonResetRequired = false;
    let remainingAttempts: number | undefined;

    if (passed) {
      // ── PASS ─────────────────────────────────────────────────────────────
      // Lesson was already marked complete via completeLesson(); no re-mark needed.
      // Recompute counters in case this is a first-time pass.
      enrollment.completedLessons = enrollment.lessonProgress.filter(
        (lp) => lp.isCompleted,
      ).length;
      enrollment.progress =
        enrollment.totalLessons > 0
          ? Math.min(
              100,
              Math.round(
                (enrollment.completedLessons / enrollment.totalLessons) * 100,
              ),
            )
          : 0;

      // Clear module-repeat block when all lessons re-completed after a forced repeat,
      // and reset the attempt counter so the student gets a fresh set.
      if (
        enrollment.requiresModuleRepeat &&
        enrollment.completedLessons >= enrollment.totalLessons
      ) {
        enrollment.requiresModuleRepeat = false;
        enrollment.finalAssessmentAttempts = 0;
      }
    } else {
      // ── FAIL ─────────────────────────────────────────────────────────────
      if (maxAttempts > 0 && lessonProgress.assessmentAttempts >= maxAttempts) {
        // Max attempts exhausted — reset this lesson so student must redo it
        lessonResetRequired = true;
        lessonProgress.isCompleted = false;
        lessonProgress.completedAt = undefined;
        lessonProgress.assessmentAttempts = 0; // Fresh count after lesson repeat

        // Recompute enrollment progress (this lesson is no longer counted)
        enrollment.completedLessons = enrollment.lessonProgress.filter(
          (lp) => lp.isCompleted,
        ).length;
        enrollment.progress =
          enrollment.totalLessons > 0
            ? Math.min(
                100,
                Math.round(
                  (enrollment.completedLessons / enrollment.totalLessons) * 100,
                ),
              )
            : 0;
      } else {
        remainingAttempts =
          maxAttempts > 0
            ? maxAttempts - lessonProgress.assessmentAttempts
            : undefined;
      }
    }

    enrollment.lastAccessedLesson = lessonIndex;
    enrollment.lastAccessedAt = new Date();

    await enrollment.save();

    // ── Navigation hint (only relevant on pass) ───────────────────────────
    let navigateTo: 'final_assessment' | 'next_lesson' | null = null;
    let nextLessonIndex: number | undefined;

    if (passed) {
      const allLessonsDone =
        enrollment.completedLessons >= enrollment.totalLessons &&
        !enrollment.requiresModuleRepeat;
      const hasFinalAssessment = (module?.finalAssessment?.questions?.length ?? 0) > 0;

      if (allLessonsDone && hasFinalAssessment) {
        navigateTo = 'final_assessment';
      } else if (allLessonsDone && !hasFinalAssessment && !enrollment.isCompleted) {
        enrollment.isCompleted = true;
        enrollment.completedAt = new Date();
        enrollment.progress = 100;
        enrollment.certificateEarned = false;
        await enrollment.save();
        await this.progressionService.onModuleCompleted(
          enrollment.studentId.toString(),
          module._id.toString(),
        );
      } else {
        const nextIncomplete = enrollment.lessonProgress
          .filter((lp) => !lp.isCompleted && lp.lessonIndex > lessonIndex)
          .sort((a, b) => a.lessonIndex - b.lessonIndex)[0];

        if (nextIncomplete) {
          navigateTo = 'next_lesson';
          nextLessonIndex = nextIncomplete.lessonIndex;
        }
      }
    }

    return {
      enrollment,
      passed,
      score,
      results,
      navigateTo,
      nextLessonIndex,
      lessonResetRequired,
      remainingAttempts,
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
  }> {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }
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

    // Check if all lessons are completed — recompute from lessonProgress to avoid
    // stale stored-counter issues (e.g. counter not updated if lessons were added
    // after enrolment, or a save race condition).
    const freshCompleted = enrollment.lessonProgress.filter((lp) => lp.isCompleted).length;
    const freshTotal = enrollment.totalLessons > 0 ? enrollment.totalLessons : enrollment.lessonProgress.length;
    if (freshCompleted < freshTotal) {
      console.warn(
        `[submitFinalAssessment] Lessons incomplete for enrollment ${enrollment._id}: ${freshCompleted}/${freshTotal} (stored counter: ${enrollment.completedLessons}/${enrollment.totalLessons})`,
      );
      throw new BadRequestException(
        'Complete all lessons before taking the final assessment.',
      );
    }

    const maxAttempts = module.finalAssessment.maxAttempts ?? 3;

    // Cooldown guard — active after exhausting a round of attempts
    if (enrollment.assessmentCooldownUntil && enrollment.assessmentCooldownUntil > new Date()) {
      const remainingMs = enrollment.assessmentCooldownUntil.getTime() - Date.now();
      const remainingMins = Math.ceil(remainingMs / 60000);
      console.log(
        `[submitFinalAssessment] Cooldown active for enrollment ${enrollment._id} — ${remainingMins} min(s) remaining`,
      );
      throw new BadRequestException(
        `Please review the lessons before retrying. Cooldown expires in ${remainingMins} minute(s).`,
      );
    }

    // If attempts are at max and cooldown already passed, reset for a fresh round
    if (maxAttempts > 0 && enrollment.finalAssessmentAttempts >= maxAttempts) {
      enrollment.finalAssessmentAttempts = 0;
      enrollment.assessmentCooldownUntil = undefined;
      console.log(
        `[submitFinalAssessment] Cooldown passed — resetting attempt counter for enrollment ${enrollment._id}`,
      );
    }

    // Check if any question is essay-type (requires manual grading)
    const hasEssayQuestions = module.finalAssessment.questions.some(
      (q: any) => q.type === 'essay',
    );

    if (hasEssayQuestions) {
      // Store the answers for instructor review
      const results = module.finalAssessment.questions.map(
        (q: any, i: number) => {
          const answer = submitDto.answers.find(
            (a: any) => a.questionIndex === i,
          );
          return {
            questionIndex: i,
            questionText: q.text,
            questionType: q.type,
            studentAnswer: answer?.answer || '',
            maxPoints: q.points,
            pointsEarned: 0,
            isCorrect: false,
          };
        },
      );

      enrollment.finalAssessmentAttempts++;
      enrollment.finalAssessmentResults = results;
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
        const instructorName =
          `${instructor.firstName} ${instructor.lastName}`.trim();
        await this.emailService
          .sendEssaySubmissionNotificationToInstructor(
            instructor.email,
            instructorName,
            studentName,
            module.title,
            enrollment._id.toString(),
          )
          .catch(() => {});

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
    console.log('[submitFinalAssessment] Submitted answers:', JSON.stringify(submitDto.answers));
    console.log('[submitFinalAssessment] Correct answers:', JSON.stringify(
      module.finalAssessment.questions.map((q: any, i: number) => ({
        index: i,
        text: q.text,
        correctAnswer: q.correctAnswer,
        options: q.options,
      }))
    ));

    const { score, results, passed } = this.gradeAssessment(
      module.finalAssessment.questions,
      submitDto.answers,
      module.finalAssessment.passingScore,
    );

    console.log('[submitFinalAssessment] Comparison results:', JSON.stringify(results.map(r => ({
      q: r.questionIndex,
      student: r.studentAnswer,
      correct: r.correctAnswer,
      isCorrect: r.isCorrect,
      points: r.pointsEarned,
    }))));
    console.log(`[submitFinalAssessment] Score: ${score}% | Passed: ${passed} | Attempts used: ${enrollment.finalAssessmentAttempts + 1}/${module.finalAssessment.maxAttempts || 3}`);

    enrollment.finalAssessmentAttempts++;
    enrollment.finalAssessmentScore = score;
    enrollment.finalAssessmentPassed = passed;
    enrollment.finalAssessmentResults = results;

    let levelUnlocked: string | undefined;
    let requiresModuleRepeat = false;
    let remainingAttempts: number | undefined;
    let message: string;

    if (passed) {
      // ── PASS ──────────────────────────────────────────────────────────────
      message = 'Congratulations! You passed the final assessment.';
      enrollment.isCompleted = true;
      enrollment.completedAt = new Date();
      // Recompute completedLessons in case counter drifted, then force progress to 100
      enrollment.completedLessons = enrollment.lessonProgress.filter((lp) => lp.isCompleted).length;
      enrollment.progress = 100;

      // Update level progression
      const progressionResult = await this.progressionService.onModuleCompleted(
        enrollment.studentId.toString(),
        module._id.toString(),
      );
      levelUnlocked = progressionResult.levelUnlocked;

      // Dashboard notifications
      const student = await this.userModel.findById(enrollment.studentId);
      if (student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.LEVEL_UNLOCKED,
          'Module Completed!',
          `Congratulations! You passed the final assessment for "${module.title}".`,
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
        // ── Max attempts exhausted → reset counter + set 20-min cooldown ──
        enrollment.finalAssessmentAttempts = 0;
        enrollment.moduleRepeatCount = (enrollment.moduleRepeatCount || 0) + 1;
        enrollment.assessmentCooldownUntil = new Date(Date.now() + 20 * 60 * 1000);
        remainingAttempts = maxAttempts;

        message = `You have used all ${maxAttempts} attempts. Please review the lessons and try again in 20 minutes.`;

        console.log(
          `[submitFinalAssessment] Cooldown set until ${enrollment.assessmentCooldownUntil.toISOString()} for enrollment ${enrollment._id}`,
        );
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

    // Strip correct answers from results when the student did not pass —
    // prevents answer harvesting by inspecting the network response.
    const sanitizedResults = passed
      ? results
      : results.map((r) => ({ ...r, correctAnswer: undefined, explanation: undefined }));

    return {
      enrollment,
      passed,
      score,
      results: sanitizedResults,
      levelUnlocked,
      requiresModuleRepeat,
      remainingAttempts,
      message,
      assessmentCooldownUntil: (enrollment.assessmentCooldownUntil as any) ?? null,
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
      studentName:
        `${student?.firstName || ''} ${student?.lastName || ''}`.trim() ||
        'Student',
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

    const student = await this.userModel.findById(enrollment.studentId);
    const studentName = student
      ? `${student.firstName} ${student.lastName}`.trim()
      : 'Student';

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (pass) {
      enrollment.isCompleted = true;
      enrollment.completedAt = new Date();
      enrollment.completedLessons = enrollment.lessonProgress.filter((lp) => lp.isCompleted).length;
      enrollment.progress = 100;

      // Update level progression
      const progressionResult = await this.progressionService.onModuleCompleted(
        enrollment.studentId.toString(),
        module._id.toString(),
      );
      levelUnlocked = progressionResult.levelUnlocked;

      const certUrl = `${frontendUrl}/student`;

      // Email student — passed
      if (student?.email) {
        await this.emailService
          .sendEssayGradingResultToStudent(
            student.email,
            studentName,
            module.title,
            true,
            feedback,
            certUrl,
          )
          .catch(() => {});
      }

      // Dashboard notifications for student
      if (student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.ESSAY_GRADED,
          'Essay Assessment Passed!',
          `Your essay for "${module.title}" has been reviewed. You passed!`,
          certUrl,
        );

        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.LEVEL_UNLOCKED,
          'Module Completed!',
          `Congratulations! You completed "${module.title}". Keep going!`,
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

      if (
        maxAttempts > 0 &&
        enrollment.finalAssessmentAttempts >= maxAttempts
      ) {
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
        await this.emailService
          .sendEssayGradingResultToStudent(
            student.email,
            studentName,
            module.title,
            false,
            feedback,
          )
          .catch(() => {});
      }

      const failMessage = requiresModuleRepeat
        ? `Your essay for "${module.title}" did not pass. You have reached the maximum number of attempts. You must review and complete the module again before reattempting.`
        : `Your essay for "${module.title}" has been reviewed. Please check the feedback and try again.`;

      if (student) {
        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.ESSAY_GRADED,
          requiresModuleRepeat
            ? 'Essay Assessment — Module Repeat Required'
            : 'Essay Assessment Reviewed',
          failMessage,
        );
      }
    }

    await enrollment.save();

    return { enrollment, passed: pass, levelUnlocked };
  }

  // ---------------------------------------------------------------------------
  // Get all final-assessment submissions for modules this instructor teaches
  // ---------------------------------------------------------------------------
  async getInstructorSubmissions(
    instructorId: string,
    filters: {
      moduleId?: string;
      submissionType?: 'essay' | 'mcq' | 'all';
      status?: 'pending' | 'passed' | 'failed' | 'all';
    },
  ): Promise<any[]> {
    // 1. Resolve which modules belong to this instructor
    const moduleQuery: any = {
      instructorIds: new Types.ObjectId(instructorId),
    };
    if (filters.moduleId) {
      moduleQuery._id = new Types.ObjectId(filters.moduleId);
    }
    const modules = await this.moduleModel
      .find(moduleQuery)
      .select('_id title level');
    const moduleMap = new Map(modules.map((m) => [m._id.toString(), m]));
    if (moduleMap.size === 0) return [];

    // 2. Build enrollment query — only enrollments that have been attempted
    const enrollmentQuery: any = {
      moduleId: {
        $in: Array.from(moduleMap.keys()).map((id) => new Types.ObjectId(id)),
      },
      finalAssessmentAttempts: { $gt: 0 },
    };
    if (filters.status === 'pending') {
      enrollmentQuery.pendingInstructorReview = true;
    } else if (filters.status === 'passed') {
      enrollmentQuery.finalAssessmentPassed = true;
    } else if (filters.status === 'failed') {
      enrollmentQuery.finalAssessmentPassed = false;
      enrollmentQuery.pendingInstructorReview = { $ne: true };
    }

    const enrollments = await this.enrollmentModel
      .find(enrollmentQuery)
      .populate('studentId', 'firstName lastName email')
      .sort({ essaySubmittedAt: -1, updatedAt: -1 });

    // 3. Shape response rows
    const rows: any[] = [];
    for (const enrollment of enrollments) {
      const student = enrollment.studentId as any;
      const module = moduleMap.get(enrollment.moduleId.toString());

      const results = enrollment.finalAssessmentResults || [];
      const hasEssay = results.some((r: any) => r.questionType === 'essay');
      const hasMcq = results.some((r: any) => r.questionType !== 'essay');

      let submissionType: string = 'mcq';
      if (hasEssay && hasMcq) submissionType = 'mixed';
      else if (hasEssay) submissionType = 'essay';

      // Apply submission type filter
      if (filters.submissionType && filters.submissionType !== 'all') {
        if (filters.submissionType === 'essay' && !hasEssay) continue;
        if (filters.submissionType === 'mcq' && hasEssay && !hasMcq) continue;
      }

      let status: string;
      if (enrollment.pendingInstructorReview) status = 'pending';
      else if (enrollment.finalAssessmentPassed) status = 'passed';
      else status = 'failed';

      rows.push({
        enrollmentId: enrollment._id,
        studentId: student?._id,
        studentName: student
          ? `${student.firstName} ${student.lastName}`.trim()
          : 'Unknown',
        studentEmail: student?.email || '',
        moduleId: module?._id,
        moduleName: module?.title || '',
        moduleLevel: (module as any)?.level || '',
        submissionType,
        submittedAt: enrollment.essaySubmittedAt || enrollment.updatedAt,
        status,
        score: enrollment.finalAssessmentScore,
        pendingInstructorReview: enrollment.pendingInstructorReview,
        finalAssessmentAttempts: enrollment.finalAssessmentAttempts,
        finalAssessmentResults: results,
      });
    }

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Get all modules assigned to an instructor (for filter dropdown)
  // ---------------------------------------------------------------------------
  async getInstructorModulesList(instructorId: string): Promise<any[]> {
    return this.moduleModel
      .find({ instructorIds: new Types.ObjectId(instructorId) })
      .select('_id title level')
      .lean();
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

      totalPoints += question.points > 0 ? question.points : 1;

      const result: any = {
        questionIndex: i,
        questionText: question.text,
        questionType: question.type,
        studentAnswer: answer?.answer || '',
        maxPoints: question.points,
        pointsEarned: 0,
      };

      // Grade by data shape, not by `type` field (type may be missing in older data).
      // A question is auto-gradable when it has an answer key AND either:
      //   • an options array  → multiple-choice
      //   • a True/False answer with no options → true-false
      const rawCorrect: string = (question.correctAnswer || question.answer || '').toString().trim();
      // Exclude all-empty-string arrays (true-false questions often have ['','','',''])
      const hasOptions = Array.isArray(question.options) && question.options.some((o: string) => o && o.trim() !== '');
      const isTrueFalse =
        !hasOptions &&
        ['true', 'false'].includes(rawCorrect.toLowerCase());
      const isAutoGradable = (hasOptions || isTrueFalse) && rawCorrect !== '';

      if (isAutoGradable) {
        // Build the resolved options list
        const options: string[] = hasOptions
          ? question.options
          : ['True', 'False'];

        // Correct answer may be stored as:
        //   "Option X"  (1-indexed label) → options[X-1]  e.g. "Option 3" → options[2]
        //   numeric index  "0"/"1"/"2"/"3"  → resolve to options[n]
        //   letter label   "A"/"B"/"C"/"D"  → resolve to options[0/1/2/3]
        //   full option text               → use as-is (case-insensitive compare)
        const optionLabelMatch = rawCorrect.match(/^[Oo]ption\s*(\d+)$/);
        const correctIdx = optionLabelMatch
          ? parseInt(optionLabelMatch[1], 10) - 1  // 1-indexed → 0-indexed
          : Number(rawCorrect);
        const letterIdx =
          !optionLabelMatch && rawCorrect.length === 1 && rawCorrect >= 'A' && rawCorrect <= 'Z'
            ? rawCorrect.charCodeAt(0) - 65 // A→0, B→1, C→2, D→3
            : -1;
        const resolvedCorrect =
          !isNaN(correctIdx) && Number.isInteger(correctIdx) && correctIdx >= 0 && correctIdx < options.length
            ? options[correctIdx]
            : letterIdx >= 0 && letterIdx < options.length
              ? options[letterIdx]
              : rawCorrect;

        const studentAnswer = (answer?.answer ?? '').trim().toLowerCase();
        const isCorrect = studentAnswer === resolvedCorrect.trim().toLowerCase();

        console.log(
          `[gradeAssessment] Q${i} | type="${question.type ?? 'no-type'}" | student="${answer?.answer}" | correct="${resolvedCorrect}" | raw="${rawCorrect}" | letterIdx=${letterIdx} | correctIdx=${correctIdx} | isCorrect=${isCorrect}`,
        );

        result.correctAnswer = resolvedCorrect;
        result.isCorrect = isCorrect;
        result.pointsEarned = isCorrect ? (question.points || 1) : 0;
        result.explanation = question.explanation;
      } else {
        // Essay / short-answer / no answer key → manual grading
        console.log(
          `[gradeAssessment] Q${i} | type="${question.type ?? 'no-type'}" | no answer key or essay — manual grading, scored 0`,
        );
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

  // ── Admin helpers ─────────────────────────────────────────────────────────────

  /** Delete a single enrollment by ID (admin testing / reset). */
  async adminDeleteEnrollment(enrollmentId: string) {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }
    const deleted = await this.enrollmentModel.findByIdAndDelete(enrollmentId).lean();
    if (!deleted) throw new NotFoundException('Enrollment not found');

    // Decrement the module enrollment count
    await this.moduleModel.findByIdAndUpdate((deleted as any).moduleId, {
      $inc: { enrollmentCount: -1 },
    });

    return { message: 'Enrollment deleted', deletedId: enrollmentId };
  }

  /** Delete ALL enrollments for a student — full fresh-start reset (admin only). */
  async adminResetStudentEnrollments(studentId: string) {
    if (!Types.ObjectId.isValid(studentId)) {
      throw new BadRequestException('Invalid student ID');
    }
    const enrollments = await this.enrollmentModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .lean();

    if (enrollments.length === 0) {
      return { message: 'No enrollments found for this student', deletedCount: 0 };
    }

    // Decrement enrollment counts on each module
    await Promise.allSettled(
      enrollments.map((e: any) =>
        this.moduleModel.findByIdAndUpdate(e.moduleId, { $inc: { enrollmentCount: -1 } }),
      ),
    );

    const result = await this.enrollmentModel.deleteMany({
      studentId: new Types.ObjectId(studentId),
    });

    return {
      message: `Reset complete — ${result.deletedCount} enrollment(s) removed for student ${studentId}`,
      deletedCount: result.deletedCount,
    };
  }

  /** Unblock a stuck student: clear cooldown, reset attempt counter, clear requiresModuleRepeat. */
  async adminResetAssessment(enrollmentId: string) {
    if (!Types.ObjectId.isValid(enrollmentId)) {
      throw new BadRequestException('Invalid enrollment ID');
    }
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    enrollment.finalAssessmentAttempts = 0;
    enrollment.assessmentCooldownUntil = undefined;
    enrollment.requiresModuleRepeat = false;
    await enrollment.save();

    return {
      message: 'Assessment reset: cooldown cleared, attempts reset, requiresModuleRepeat cleared.',
      enrollmentId,
    };
  }
}
