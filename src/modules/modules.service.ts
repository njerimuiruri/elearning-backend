import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Module, ModuleStatus, ModuleLevel } from '../schemas/module.schema';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { ActivityLog, ActivityType } from '../schemas/activity-log.schema';
import { CreateModuleDto, CreateLessonDto, FinalAssessmentDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { EmailService } from '../common/services/email.service';

const ADMIN_EMAIL = 'faith.muiruri@strathmore.edu';

@Injectable()
export class ModulesService {
  constructor(
    @InjectModel(Module.name) private moduleModel: Model<Module>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(ModuleEnrollment.name) private moduleEnrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(ActivityLog.name) private activityLogModel: Model<ActivityLog>,
    private emailService: EmailService,
  ) {}

  // Create module
  async createModule(
    instructorId: string,
    createModuleDto: CreateModuleDto,
  ): Promise<Module> {
    // Validate category exists
    const category = await this.categoryModel.findById(
      createModuleDto.categoryId,
    );
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const module = new this.moduleModel({
      ...createModuleDto,
      categoryId: new Types.ObjectId(createModuleDto.categoryId),
      instructorIds: [new Types.ObjectId(instructorId)],
      status: ModuleStatus.DRAFT,
    });

    return await module.save();
  }

  // Get modules by level and category (for student browsing)
  async getModulesByLevelAndCategory(
    categoryId: string,
    level: ModuleLevel,
    status?: ModuleStatus,
  ) {
    return await this.moduleModel
      .find({
        categoryId: new Types.ObjectId(categoryId),
        level,
        status: status
          ? status
          : { $in: [ModuleStatus.PUBLISHED, ModuleStatus.APPROVED] },
        isActive: true
      })
      .populate('instructorIds', 'firstName lastName avgRating')
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  // Get all published modules with filters
  async getAllPublishedModules(filters?: {
    category?: string;
    level?: ModuleLevel;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ modules: any[]; total: number; pages: number }> {
    const query: any = {
      status: { $in: [ModuleStatus.PUBLISHED, ModuleStatus.APPROVED] },
      isActive: true,
    };

    if (filters?.category) {
      query.categoryId = new Types.ObjectId(filters.category);
    }

    if (filters?.level) {
      query.level = filters.level;
    }

    if (filters?.search) {
      query.$or = [
        { title: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
      ];
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const [modules, total] = await Promise.all([
      this.moduleModel
        .find(query)
        .populate('instructorIds', 'firstName lastName avgRating')
        .populate('categoryId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.moduleModel.countDocuments(query),
    ]);

    return {
      modules,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  // Get instructor's modules
  async getInstructorModules(instructorId: string) {
    return await this.moduleModel
      .find({
        instructorIds: new Types.ObjectId(instructorId),
        isActive: true,
      })
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  // Get module by ID
  async getModuleById(moduleId: string): Promise<Module> {
    const module = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds', 'firstName lastName email avgRating')
      .populate('categoryId', 'name price accessType');

    if (!module) {
      throw new NotFoundException('Module not found');
    }

    return module;
  }

  // Update module
  async updateModule(
    moduleId: string,
    instructorId: string,
    updateModuleDto: UpdateModuleDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);

    if (!module) {
      throw new NotFoundException('Module not found');
    }

    // Authorization check
    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized to update this module');
    }

    Object.assign(module, updateModuleDto, {
      lastEditedBy: new Types.ObjectId(instructorId),
      lastEditedAt: new Date(),
    });

    return await module.save();
  }

  // Normalise resources: accept both legacy string URLs and new {url,name,fileType} objects
  private normaliseResources(raw: any[]): { url: string; name: string; fileType: string }[] {
    return (raw || []).map((r) => {
      if (typeof r === 'string') {
        const filename = r.split('/').pop() || 'Resource';
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return { url: r, name: filename, fileType: ext };
      }
      return {
        url: r.url || '',
        name: r.name || r.url?.split('/').pop() || 'Resource',
        fileType: r.fileType || r.url?.split('.').pop()?.toLowerCase() || '',
      };
    });
  }

  // Add lesson to module
  async addLesson(
    moduleId: string,
    instructorId: string,
    lessonData: CreateLessonDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    // Authorization check
    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    const lessonToAdd: any = {
      ...lessonData,
      resources: this.normaliseResources(lessonData.resources as any[]),
      order: lessonData.order || module.lessons.length,
    };

    // Auto-create assessment placeholder if not provided
    if (!lessonToAdd.assessment) {
      lessonToAdd.assessment = {
        title: `${lessonData.title} Assessment`,
        description: '',
        questions: [],
        passingScore: 70,
        maxAttempts: 3,
      };
    }

    module.lessons.push(lessonToAdd);

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // Update lesson
  async updateLesson(
    moduleId: string,
    lessonIndex: number,
    instructorId: string,
    lessonData: CreateLessonDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length) {
      throw new NotFoundException('Lesson not found');
    }

    Object.assign(module.lessons[lessonIndex], lessonData, {
      resources: this.normaliseResources(lessonData.resources as any[]),
      lastEditedBy: new Types.ObjectId(instructorId),
      lastEditedAt: new Date(),
    });

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // Delete lesson
  async deleteLesson(
    moduleId: string,
    lessonIndex: number,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length) {
      throw new NotFoundException('Lesson not found');
    }

    module.lessons.splice(lessonIndex, 1);
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // Set final assessment (required)
  async setFinalAssessment(
    moduleId: string,
    instructorId: string,
    assessmentData: FinalAssessmentDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    module.finalAssessment = assessmentData as any;
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // Submit for approval
  async submitForApproval(
    moduleId: string,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    // Validation
    if (!module.finalAssessment || module.finalAssessment.questions.length === 0) {
      throw new BadRequestException('Module must have a final assessment');
    }

    if (module.lessons.length === 0) {
      throw new BadRequestException('Module must have at least one lesson');
    }

    module.status = ModuleStatus.SUBMITTED;
    module.submittedAt = new Date();

    await module.save();

    // Fetch instructor and category details for notifications
    const [instructor, category] = await Promise.all([
      this.userModel.findById(instructorId).select('firstName lastName email').lean(),
      this.categoryModel.findById(module.categoryId).select('name').lean(),
    ]);

    const instructorName = instructor
      ? `${instructor.firstName || ''} ${instructor.lastName || ''}`.trim()
      : 'Unknown Instructor';
    const instructorEmail = (instructor as any)?.email || '';
    const categoryName = (category as any)?.name || 'Unknown Category';

    // Log activity so it appears in the admin dashboard notification feed
    try {
      await this.activityLogModel.create({
        type: ActivityType.COURSE_CREATED,
        message: `Module "${module.title}" by ${instructorName} has been submitted for review`,
        performedBy: instructorId,
        metadata: { moduleId: module._id, moduleTitle: module.title, instructorName, categoryName },
        icon: 'BookOpen',
      });
    } catch (err) {
      console.error('Failed to log module submission activity:', err);
    }

    // Email admin about the new module submission
    try {
      await this.emailService.sendModuleSubmissionNotificationToAdmin(
        ADMIN_EMAIL,
        instructorName,
        instructorEmail,
        module.title,
        categoryName,
        module._id.toString(),
      );
    } catch (err) {
      console.error('Failed to send module submission email to admin:', err);
    }

    return module;
  }

  // Admin: Approve module
  async approveModule(moduleId: string, adminId: string): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    module.status = ModuleStatus.APPROVED;
    module.approvedBy = new Types.ObjectId(adminId);
    module.approvedAt = new Date();

    return await module.save();
  }

  // Admin: Publish module
  async publishModule(moduleId: string, adminId: string): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (module.status !== ModuleStatus.APPROVED) {
      throw new BadRequestException(
        'Module must be approved before publishing',
      );
    }

    module.status = ModuleStatus.PUBLISHED;
    module.publishedAt = new Date();

    return await module.save();
  }

  // Admin: Reject module
  async rejectModule(
    moduleId: string,
    adminId: string,
    rejectionReason: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    module.status = ModuleStatus.REJECTED;
    module.rejectionReason = rejectionReason;

    return await module.save();
  }

  // Delete module (soft delete)
  async deleteModule(moduleId: string, instructorId: string): Promise<void> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    module.isActive = false;
    await module.save();
  }

  // Get instructor's module stats
  async getInstructorModuleStats(instructorId: string) {
    const instructorObjId = new Types.ObjectId(instructorId);

    const modules = await this.moduleModel
      .find({ instructorIds: instructorObjId, isActive: true })
      .lean();

    const moduleIds = modules.map((m) => m._id);

    const enrollmentStats = await this.moduleEnrollmentModel.aggregate([
      { $match: { moduleId: { $in: moduleIds } } },
      {
        $group: {
          _id: null,
          totalStudents: { $sum: 1 },
          completedStudents: { $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] } },
          avgProgress: { $avg: '$overallProgress' },
        },
      },
    ]);

    const stats = enrollmentStats[0] || { totalStudents: 0, completedStudents: 0, avgProgress: 0 };

    const modulesByStatus = {
      draft: modules.filter((m) => m.status === ModuleStatus.DRAFT).length,
      submitted: modules.filter((m) => m.status === ModuleStatus.SUBMITTED).length,
      approved: modules.filter((m) => m.status === ModuleStatus.APPROVED).length,
      published: modules.filter((m) => m.status === ModuleStatus.PUBLISHED).length,
      rejected: modules.filter((m) => m.status === ModuleStatus.REJECTED).length,
    };

    // Calculate total content hours
    let totalDurationMinutes = 0;
    for (const mod of modules) {
      for (const lesson of mod.lessons || []) {
        if (lesson.duration) {
          const match = lesson.duration.match(/(\d+)/);
          if (match) totalDurationMinutes += parseInt(match[1]);
        }
      }
    }

    return {
      totalModules: modules.length,
      modulesByStatus,
      totalStudents: stats.totalStudents,
      completedStudents: stats.completedStudents,
      completionRate: stats.totalStudents > 0
        ? Math.round((stats.completedStudents / stats.totalStudents) * 100)
        : 0,
      avgProgress: Math.round(stats.avgProgress || 0),
      totalContentHours: Math.round(totalDurationMinutes / 60 * 10) / 10,
    };
  }
}
