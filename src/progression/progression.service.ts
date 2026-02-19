import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StudentProgression } from '../schemas/student-progression.schema';
import { Module, ModuleLevel, ModuleStatus } from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';

@Injectable()
export class ProgressionService {
  constructor(
    @InjectModel(StudentProgression.name)
    private progressionModel: Model<StudentProgression>,
    @InjectModel(Module.name)
    private moduleModel: Model<Module>,
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
  ) {}

  // Initialize progression for student in category
  async initializeProgression(
    studentId: string,
    categoryId: string,
  ) {
    // Check if already exists
    const existing = await this.progressionModel.findOne({
      studentId: new Types.ObjectId(studentId),
      categoryId: new Types.ObjectId(categoryId),
    });

    if (existing) {
      return existing;
    }

    // Count modules per level in this category
    const [beginnerCount, intermediateCount, advancedCount] =
      await Promise.all([
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
      ]);

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
      totalModulesInCategory:
        beginnerCount + intermediateCount + advancedCount,
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

    const progression = await this.progressionModel.findOne({
      studentId: new Types.ObjectId(studentId),
      categoryId: new Types.ObjectId(categoryId),
    });

    if (!progression) return false;

    const levelProgress = progression.levelProgress.find(
      (lp) => lp.level === level,
    );
    return levelProgress?.isUnlocked || false;
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
    intermediate: { unlocked: boolean; completed: boolean; completedAt?: Date; reason?: string };
    advanced: { unlocked: boolean; completed: boolean; completedAt?: Date; reason?: string };
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

    // Add to completed modules if not already there
    if (
      !progression.completedModuleIds.some(
        (id) => id.toString() === moduleId,
      )
    ) {
      progression.completedModuleIds.push(new Types.ObjectId(moduleId));
      progression.totalModulesCompleted++;
    }

    // Update level progress
    const levelProgress = progression.levelProgress.find(
      (lp) => lp.level === module.level,
    );

    let levelUnlocked: string | undefined;

    if (levelProgress) {
      levelProgress.completedModules++;

      // Check if level is complete
      if (levelProgress.completedModules >= levelProgress.totalModules) {
        levelProgress.isCompleted = true;
        levelProgress.completedAt = new Date();

        // Unlock next level
        levelUnlocked = this.unlockNextLevel(progression, module.level);
      }
    }

    progression.overallProgress = progression.totalModulesInCategory > 0
      ? Math.round(
          (progression.totalModulesCompleted /
            progression.totalModulesInCategory) *
            100,
        )
      : 0;

    await progression.save();

    return { levelUnlocked, progression };
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
  async getProgressionStatus(
    studentId: string,
    categoryId: string,
  ) {
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
