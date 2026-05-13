import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StudentProgression } from '../schemas/student-progression.schema';
import { Module, ModuleLevel, ModuleStatus } from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { User } from '../schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../schemas/notification.schema';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class ProgressionService {
  constructor(
    @InjectModel(StudentProgression.name)
    private progressionModel: Model<StudentProgression>,
    @InjectModel(Module.name)
    private moduleModel: Model<Module>,
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
  ) {}

  // Initialize progression for student in category
  async initializeProgression(studentId: string, categoryId: string) {
    // Check if already exists
    const existing = await this.progressionModel.findOne({
      studentId: new Types.ObjectId(studentId),
      categoryId: new Types.ObjectId(categoryId),
    });

    if (existing) {
      return existing;
    }

    // Count modules per level in this category
    const [beginnerCount, intermediateCount, advancedCount] = await Promise.all(
      [
        this.moduleModel.countDocuments({
          categoryId: new Types.ObjectId(categoryId),
          level: ModuleLevel.BEGINNER,
          status: ModuleStatus.PUBLISHED,
          isActive: true,
        }),
        this.moduleModel.countDocuments({
          categoryId: new Types.ObjectId(categoryId),
          level: ModuleLevel.INTERMEDIATE,
          status: ModuleStatus.PUBLISHED,
          isActive: true,
        }),
        this.moduleModel.countDocuments({
          categoryId: new Types.ObjectId(categoryId),
          level: ModuleLevel.ADVANCED,
          status: ModuleStatus.PUBLISHED,
          isActive: true,
        }),
      ],
    );

    const progression = new this.progressionModel({
      studentId: new Types.ObjectId(studentId),
      categoryId: new Types.ObjectId(categoryId),
      currentLevel: ModuleLevel.BEGINNER,
      levelProgress: [
        {
          level: ModuleLevel.BEGINNER,
          totalModules: beginnerCount,
          completedModules: 0,
          isUnlocked: true,
          unlockedAt: new Date(),
        },
        {
          level: ModuleLevel.INTERMEDIATE,
          totalModules: intermediateCount,
          completedModules: 0,
          isUnlocked: false,
        },
        {
          level: ModuleLevel.ADVANCED,
          totalModules: advancedCount,
          completedModules: 0,
          isUnlocked: false,
        },
      ],
      totalModulesInCategory: beginnerCount + intermediateCount + advancedCount,
    });

    return await progression.save();
  }

  // Check if student can access a specific module level
  async canAccessLevel(
    studentId: string,
    categoryId: string,
    level: ModuleLevel,
  ): Promise<boolean> {
    // Beginner is always accessible
    if (level === ModuleLevel.BEGINNER) return true;

    const requiredLevel =
      level === ModuleLevel.INTERMEDIATE
        ? ModuleLevel.BEGINNER
        : ModuleLevel.INTERMEDIATE;

    // Use actual completed enrollments as ground truth instead of the stored
    // counter, which can drift when onModuleCompleted calls are missed or the
    // totalModules snapshot becomes stale after module publish/unpublish actions.
    const requiredModules = await this.moduleModel
      .find({
        categoryId: new Types.ObjectId(categoryId),
        level: requiredLevel,
        status: ModuleStatus.PUBLISHED,
        isActive: true,
      })
      .select('_id')
      .lean();

    // No prerequisite modules published → open access
    if (requiredModules.length === 0) return true;

    const completedCount = await this.enrollmentModel.countDocuments({
      studentId: new Types.ObjectId(studentId),
      moduleId: { $in: requiredModules.map((m) => m._id) },
      isCompleted: true,
    });

    const allCompleted = completedCount >= requiredModules.length;

    if (allCompleted) {
      // Eagerly repair the progression document so the frontend also reflects
      // the correct state on the next data fetch.
      await this.repairLevelUnlock(studentId, categoryId, requiredLevel);
    }

    return allCompleted;
  }

  private async repairLevelUnlock(
    studentId: string,
    categoryId: string,
    completedLevel: ModuleLevel,
  ): Promise<void> {
    const progression = await this.progressionModel.findOne({
      studentId: new Types.ObjectId(studentId),
      categoryId: new Types.ObjectId(categoryId),
    });
    if (!progression) return;

    const nextLevel =
      completedLevel === ModuleLevel.BEGINNER
        ? ModuleLevel.INTERMEDIATE
        : ModuleLevel.ADVANCED;

    const levelProgress = progression.levelProgress.find(
      (lp) => lp.level === completedLevel,
    );
    const nextLevelProgress = progression.levelProgress.find(
      (lp) => lp.level === nextLevel,
    );

    let needsSave = false;

    if (levelProgress && !levelProgress.isCompleted) {
      levelProgress.isCompleted = true;
      levelProgress.completedAt = new Date();
      needsSave = true;
    }

    let justUnlocked = false;
    if (nextLevelProgress && !nextLevelProgress.isUnlocked) {
      nextLevelProgress.isUnlocked = true;
      nextLevelProgress.unlockedAt = new Date();
      if (progression.currentLevel === completedLevel) {
        progression.currentLevel = nextLevel;
      }
      needsSave = true;
      justUnlocked = true;
    }

    if (needsSave) {
      await progression.save();
    }

    if (justUnlocked) {
      this.notifyLevelUnlocked(studentId, nextLevel).catch(() => {});
    }
  }

  /**
   * Returns a detailed access status for all three levels in a category.
   * Used by the frontend to display lock/unlock state on the student UI.
   */
  async getLevelAccessStatus(
    studentId: string,
    categoryId: string,
  ): Promise<{
    beginner: { unlocked: boolean; completed: boolean; completedAt?: Date };
    intermediate: {
      unlocked: boolean;
      completed: boolean;
      completedAt?: Date;
      reason?: string;
    };
    advanced: {
      unlocked: boolean;
      completed: boolean;
      completedAt?: Date;
      reason?: string;
    };
  }> {
    const progression = await this.progressionModel.findOne({
      studentId: new Types.ObjectId(studentId),
      categoryId: new Types.ObjectId(categoryId),
    });

    const findLevel = (level: ModuleLevel) =>
      progression?.levelProgress.find((lp) => lp.level === level);

    const begP = findLevel(ModuleLevel.BEGINNER);
    const intP = findLevel(ModuleLevel.INTERMEDIATE);
    const advP = findLevel(ModuleLevel.ADVANCED);

    const beginnerCompleted = begP?.isCompleted || false;

    return {
      beginner: {
        unlocked: true, // Always unlocked
        completed: beginnerCompleted,
        completedAt: begP?.completedAt,
      },
      intermediate: {
        unlocked: intP?.isUnlocked || false,
        completed: intP?.isCompleted || false,
        completedAt: intP?.completedAt,
        reason: intP?.isUnlocked
          ? undefined
          : 'Complete and pass all Beginner modules to unlock this level.',
      },
      advanced: {
        unlocked: advP?.isUnlocked || false,
        completed: advP?.isCompleted || false,
        completedAt: advP?.completedAt,
        reason: advP?.isUnlocked
          ? undefined
          : 'Complete and pass all Intermediate modules to unlock this level.',
      },
    };
  }

  // Mark module as completed and check for level progression
  async onModuleCompleted(
    studentId: string,
    moduleId: string,
  ): Promise<{ levelUnlocked?: string; progression: any }> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    let progression = await this.progressionModel.findOne({
      studentId: new Types.ObjectId(studentId),
      categoryId: module.categoryId,
    });

    if (!progression) {
      progression = await this.initializeProgression(
        studentId,
        module.categoryId.toString(),
      );
    }

    const isNewCompletion = !progression.completedModuleIds.some(
      (id) => id.toString() === moduleId,
    );

    if (isNewCompletion) {
      progression.completedModuleIds.push(new Types.ObjectId(moduleId));
      progression.totalModulesCompleted++;
    }

    // Update level progress
    const levelProgress = progression.levelProgress.find(
      (lp) => lp.level === module.level,
    );

    let levelUnlocked: string | undefined;

    if (levelProgress) {
      // Only increment when this is the first completion of this module.
      // Without this guard the counter inflates on repeated calls (e.g. when a
      // student retakes and passes the final assessment) and can permanently
      // exceed totalModules, making further completions appear already done.
      if (isNewCompletion) {
        levelProgress.completedModules++;
      }

      // Refresh totalModules from the DB so that modules published/unpublished
      // after the progression was initialised are correctly accounted for.
      const currentTotal = await this.moduleModel.countDocuments({
        categoryId: module.categoryId,
        level: module.level,
        status: ModuleStatus.PUBLISHED,
        isActive: true,
      });
      if (currentTotal > 0) {
        levelProgress.totalModules = currentTotal;
      }

      // Check if level is complete
      if (levelProgress.completedModules >= levelProgress.totalModules) {
        levelProgress.isCompleted = true;
        levelProgress.completedAt = new Date();

        // Unlock next level
        levelUnlocked = this.unlockNextLevel(progression, module.level);
      }
    }

    if (levelUnlocked) {
      this.notifyLevelUnlocked(studentId, levelUnlocked).catch(() => {});
    }

    progression.overallProgress =
      progression.totalModulesInCategory > 0
        ? Math.round(
            (progression.totalModulesCompleted /
              progression.totalModulesInCategory) *
              100,
          )
        : 0;

    await progression.save();

    return { levelUnlocked, progression };
  }

  private async notifyLevelUnlocked(
    studentId: string,
    unlockedLevel: string,
  ): Promise<void> {
    const levelLabel =
      unlockedLevel.charAt(0).toUpperCase() + unlockedLevel.slice(1);

    const student = await this.userModel
      .findById(studentId)
      .select('firstName lastName email')
      .lean();

    if (!student) return;

    const studentName =
      `${(student as any).firstName || ''} ${(student as any).lastName || ''}`.trim() ||
      'Fellow';

    // Dashboard notification
    await this.notificationsService
      .createNotification(
        studentId,
        NotificationType.LEVEL_UNLOCKED,
        `${levelLabel} Level Unlocked!`,
        `Congratulations! You've completed all Beginner modules and unlocked the ${levelLabel} Level. You can now enrol in any ${levelLabel} module.`,
      )
      .catch(() => {});

    // Email
    if ((student as any).email) {
      await this.emailService
        .sendLevelUnlockedEmail(
          (student as any).email,
          studentName,
          unlockedLevel,
        )
        .catch(() => {});
    }
  }

  private unlockNextLevel(
    progression: any,
    currentLevel: ModuleLevel,
  ): string | undefined {
    let nextLevel: ModuleLevel | undefined;

    if (currentLevel === ModuleLevel.BEGINNER) {
      nextLevel = ModuleLevel.INTERMEDIATE;
    } else if (currentLevel === ModuleLevel.INTERMEDIATE) {
      nextLevel = ModuleLevel.ADVANCED;
    }

    if (nextLevel) {
      const nextLevelProgress = progression.levelProgress.find(
        (lp: any) => lp.level === nextLevel,
      );

      if (nextLevelProgress && !nextLevelProgress.isUnlocked) {
        nextLevelProgress.isUnlocked = true;
        nextLevelProgress.unlockedAt = new Date();
        progression.currentLevel = nextLevel;
        return nextLevel;
      }
    }

    return undefined;
  }

  // Get student's progression status for a category
  async getProgressionStatus(studentId: string, categoryId: string) {
    let progression = await this.progressionModel
      .findOne({
        studentId: new Types.ObjectId(studentId),
        categoryId: new Types.ObjectId(categoryId),
      })
      .populate('categoryId', 'name');

    if (!progression) {
      progression = await this.initializeProgression(studentId, categoryId);
    }

    return progression;
  }

  // Get all progressions for a student
  async getAllProgressions(studentId: string) {
    return await this.progressionModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .populate('categoryId', 'name')
      .sort({ updatedAt: -1 });
  }
}
