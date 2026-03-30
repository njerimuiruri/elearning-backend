import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Module,
  ModuleStatus,
  ModuleLevel,
  AssessmentReviewStatus,
} from '../schemas/module.schema';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { ActivityLog, ActivityType } from '../schemas/activity-log.schema';
import {
  CreateModuleDto,
  CreateModuleLessonDto,
  CreateLessonDto,
  FinalAssessmentDto,
  SlideDto,
} from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { EmailService } from '../common/services/email.service';
import * as archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import PptxGenJS from 'pptxgenjs';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  PageBreak,
  HorizontalPositionAlign,
} from 'docx';

const ADMIN_EMAIL = 'faith.muiruri@strathmore.edu';

@Injectable()
export class ModulesService {
  constructor(
    @InjectModel(Module.name) private moduleModel: Model<Module>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(ModuleEnrollment.name)
    private moduleEnrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(ActivityLog.name) private activityLogModel: Model<ActivityLog>,
    private emailService: EmailService,
  ) {}

  // ── Helper: get all lessons (direct lessons first, fall back to topics) ──
  getAllLessons(module: any): any[] {
    // Prefer the new direct-lessons structure
    if (module.lessons && module.lessons.length > 0) {
      return [...module.lessons].sort(
        (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0),
      );
    }
    // Fall back to legacy topics → lessons (flattened)
    return (module.topics || []).flatMap((t: any) => t.lessons || []);
  }

  // ── Helper: normalise resources ──────────────────────────────────────────
  private normaliseResources(
    raw: any[],
  ): { url: string; name: string; description: string; fileType: string }[] {
    return (raw || []).map((r) => {
      if (typeof r === 'string') {
        const filename = r.split('/').pop() || 'Resource';
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return { url: r, name: filename, description: '', fileType: ext };
      }
      return {
        url: r.url || '',
        name: r.name || r.url?.split('/').pop() || 'Resource',
        description: r.description || '',
        fileType: r.fileType || r.url?.split('.').pop()?.toLowerCase() || '',
      };
    });
  }

  // ── Create module ─────────────────────────────────────────────────────────
  async createModule(
    instructorId: string,
    createModuleDto: CreateModuleDto,
  ): Promise<Module> {
    const category = await this.categoryModel.findById(
      createModuleDto.categoryId,
    );
    if (!category) throw new NotFoundException('Category not found');

    const module = new this.moduleModel({
      ...createModuleDto,
      categoryId: new Types.ObjectId(createModuleDto.categoryId),
      instructorIds: [new Types.ObjectId(instructorId)],
      status: ModuleStatus.DRAFT,
    });

    return await module.save();
  }

  // ── Get modules by level and category ────────────────────────────────────
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
        isActive: true,
      })
      .populate('instructorIds', 'firstName lastName avgRating')
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  // ── Get all published modules with filters ────────────────────────────────
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

    if (filters?.category)
      query.categoryId = new Types.ObjectId(filters.category);
    if (filters?.level) query.level = filters.level;
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

    return { modules, total, pages: Math.ceil(total / limit) };
  }

  // ── Get instructor's modules ──────────────────────────────────────────────
  async getInstructorModules(instructorId: string) {
    // Look up the instructor's email so we can also return modules pre-assigned via pendingInstructorEmail
    const instructor = await this.userModel
      .findById(instructorId)
      .select('email')
      .lean();
    const emailFilter = (instructor as any)?.email
      ? [
          { instructorIds: new Types.ObjectId(instructorId) },
          { pendingInstructorEmail: (instructor as any).email },
        ]
      : [{ instructorIds: new Types.ObjectId(instructorId) }];

    return await this.moduleModel
      .find({ $or: emailFilter, isActive: true })
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  // ── Admin: Create module on behalf of an instructor ───────────────────────
  async createModuleAsAdmin(
    adminId: string,
    createModuleDto: CreateModuleDto,
  ): Promise<Module> {
    const {
      assignedInstructorId,
      pendingInstructorEmail,
      pendingInstructorName,
      ...rest
    } = createModuleDto;

    const category = await this.categoryModel.findById(rest.categoryId);
    if (!category) throw new NotFoundException('Category not found');

    let instructorIds: Types.ObjectId[] = [];

    if (assignedInstructorId) {
      const instructor = await this.userModel.findById(assignedInstructorId);
      if (!instructor)
        throw new NotFoundException('Assigned instructor not found');
      instructorIds = [new Types.ObjectId(assignedInstructorId)];
    }

    const module = new this.moduleModel({
      ...rest,
      categoryId: new Types.ObjectId(rest.categoryId),
      instructorIds,
      ...(pendingInstructorEmail && !assignedInstructorId
        ? { pendingInstructorEmail, pendingInstructorName }
        : {}),
      createdBy: new Types.ObjectId(adminId),
      createdByRole: 'admin',
      status: ModuleStatus.DRAFT,
    });

    return await module.save();
  }

  // ── Get module by ID ──────────────────────────────────────────────────────
  async getModuleById(moduleId: string): Promise<Module> {
    const module = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds', 'firstName lastName email avgRating')
      .populate('categoryId', 'name price accessType');

    if (!module) throw new NotFoundException('Module not found');
    return module;
  }

  // ── Update module metadata ────────────────────────────────────────────────
  async updateModule(
    moduleId: string,
    instructorId: string,
    updateModuleDto: UpdateModuleDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    const isAssigned = module.instructorIds.some(
      (id) => id.toString() === instructorId,
    );
    const isAdminCreatedUnassigned = module.instructorIds.length === 0;

    if (!isAssigned && !isAdminCreatedUnassigned) {
      throw new UnauthorizedException('Not authorized to update this module');
    }

    Object.assign(module, updateModuleDto, {
      lastEditedBy: new Types.ObjectId(instructorId),
      lastEditedAt: new Date(),
    });

    return await module.save();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIRECT LESSON METHODS (Category → Module → Lesson)
  // ══════════════════════════════════════════════════════════════════════════

  async addModuleLesson(
    moduleId: string,
    instructorId: string,
    lessonData: CreateModuleLessonDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    const lesson: any = {
      ...lessonData,
      lessonResources: this.normaliseResources(
        (lessonData.lessonResources as any[]) || [],
      ),
      order: lessonData.order ?? module.lessons.length,
      slides: (lessonData.slides || []).map((s, i) => ({
        ...s,
        order: s.order ?? i,
        minViewingTime: s.minViewingTime ?? 15,
        scrollTrackingEnabled: s.scrollTrackingEnabled ?? false,
      })),
    };

    module.lessons.push(lesson);
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async updateModuleLesson(
    moduleId: string,
    lessonIndex: number,
    instructorId: string,
    lessonData: CreateModuleLessonDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length)
      throw new NotFoundException('Lesson not found');

    Object.assign(module.lessons[lessonIndex], {
      ...lessonData,
      lessonResources: this.normaliseResources(
        (lessonData.lessonResources as any[]) || [],
      ),
    });

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async deleteModuleLesson(
    moduleId: string,
    lessonIndex: number,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length)
      throw new NotFoundException('Lesson not found');

    module.lessons.splice(lessonIndex, 1);
    // Re-assign order values
    module.lessons.forEach((l, i) => {
      (l as any).order = i;
    });

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async reorderLessons(
    moduleId: string,
    instructorId: string,
    lessonOrders: Array<{ lessonIndex: number; order: number }>,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    for (const { lessonIndex, order } of lessonOrders) {
      if (lessonIndex < module.lessons.length) {
        (module.lessons[lessonIndex] as any).order = order;
      }
    }

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SLIDE METHODS
  // ══════════════════════════════════════════════════════════════════════════

  async addSlide(
    moduleId: string,
    lessonIndex: number,
    instructorId: string,
    slideData: SlideDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length)
      throw new NotFoundException('Lesson not found');

    const slide: any = {
      ...slideData,
      order: slideData.order ?? module.lessons[lessonIndex].slides.length,
      minViewingTime: slideData.minViewingTime ?? 15,
      scrollTrackingEnabled: slideData.scrollTrackingEnabled ?? false,
    };

    module.lessons[lessonIndex].slides.push(slide);
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async updateSlide(
    moduleId: string,
    lessonIndex: number,
    slideIndex: number,
    instructorId: string,
    slideData: SlideDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length)
      throw new NotFoundException('Lesson not found');
    if (slideIndex >= module.lessons[lessonIndex].slides.length)
      throw new NotFoundException('Slide not found');

    Object.assign(module.lessons[lessonIndex].slides[slideIndex], slideData);

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async deleteSlide(
    moduleId: string,
    lessonIndex: number,
    slideIndex: number,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length)
      throw new NotFoundException('Lesson not found');
    if (slideIndex >= module.lessons[lessonIndex].slides.length)
      throw new NotFoundException('Slide not found');

    module.lessons[lessonIndex].slides.splice(slideIndex, 1);
    module.lessons[lessonIndex].slides.forEach((s, i) => {
      (s as any).order = i;
    });

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async reorderSlides(
    moduleId: string,
    lessonIndex: number,
    instructorId: string,
    slideOrders: Array<{ slideIndex: number; order: number }>,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (lessonIndex >= module.lessons.length)
      throw new NotFoundException('Lesson not found');

    const slides = module.lessons[lessonIndex].slides;
    for (const { slideIndex, order } of slideOrders) {
      if (slideIndex < slides.length) {
        (slides[slideIndex] as any).order = order;
      }
    }

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY TOPIC METHODS (backward compat)
  // ══════════════════════════════════════════════════════════════════════════

  async deleteTopic(
    moduleId: string,
    topicIndex: number,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (topicIndex >= module.topics.length)
      throw new NotFoundException('Topic not found');

    module.topics.splice(topicIndex, 1);
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async addLesson(
    moduleId: string,
    instructorId: string,
    topicIndex: number,
    lessonData: CreateLessonDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (topicIndex >= module.topics.length) {
      throw new NotFoundException('Topic not found');
    }

    const lessonToAdd: any = {
      ...lessonData,
      lessonResources: this.normaliseResources(
        lessonData.lessonResources as any[],
      ),
      order: lessonData.order ?? module.topics[topicIndex].lessons.length,
    };

    module.topics[topicIndex].lessons.push(lessonToAdd);
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async updateLesson(
    moduleId: string,
    topicIndex: number,
    lessonIndex: number,
    instructorId: string,
    lessonData: CreateLessonDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (topicIndex >= module.topics.length)
      throw new NotFoundException('Topic not found');
    if (lessonIndex >= module.topics[topicIndex].lessons.length)
      throw new NotFoundException('Lesson not found');

    Object.assign(module.topics[topicIndex].lessons[lessonIndex], lessonData, {
      lessonResources: this.normaliseResources(
        lessonData.lessonResources as any[],
      ),
      lastEditedBy: new Types.ObjectId(instructorId),
      lastEditedAt: new Date(),
    });

    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  async deleteLesson(
    moduleId: string,
    topicIndex: number,
    lessonIndex: number,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    if (topicIndex >= module.topics.length)
      throw new NotFoundException('Topic not found');
    if (lessonIndex >= module.topics[topicIndex].lessons.length)
      throw new NotFoundException('Lesson not found');

    module.topics[topicIndex].lessons.splice(lessonIndex, 1);
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();

    return await module.save();
  }

  // ── Set final assessment ──────────────────────────────────────────────────
  async setFinalAssessment(
    moduleId: string,
    instructorId: string,
    assessmentData: FinalAssessmentDto,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    module.finalAssessment = assessmentData as any;
    module.lastEditedBy = new Types.ObjectId(instructorId);
    module.lastEditedAt = new Date();
    module.assessmentUpdatedAt = new Date();

    // Flag for admin review when module is already live (not a draft being built)
    if (
      module.status !== ModuleStatus.DRAFT &&
      module.status !== ModuleStatus.REJECTED
    ) {
      module.assessmentReviewStatus = AssessmentReviewStatus.PENDING;
    }

    return await module.save();
  }

  // ── Submit for approval ───────────────────────────────────────────────────
  async submitForApproval(
    moduleId: string,
    instructorId: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    const totalLessons = this.getAllLessons(module).length;
    if (totalLessons === 0) {
      throw new BadRequestException('Module must have at least one lesson');
    }

    module.status = ModuleStatus.SUBMITTED;
    module.submittedAt = new Date();

    await module.save();

    const [instructor, category] = await Promise.all([
      this.userModel
        .findById(instructorId)
        .select('firstName lastName email')
        .lean(),
      this.categoryModel.findById(module.categoryId).select('name').lean(),
    ]);

    const instructorName = instructor
      ? `${instructor.firstName || ''} ${instructor.lastName || ''}`.trim()
      : 'Unknown Instructor';
    const instructorEmail = (instructor as any)?.email || '';
    const categoryName = (category as any)?.name || 'Unknown Category';

    try {
      await this.activityLogModel.create({
        type: ActivityType.COURSE_CREATED,
        message: `Module "${module.title}" by ${instructorName} has been submitted for review`,
        performedBy: instructorId,
        metadata: {
          moduleId: module._id,
          moduleTitle: module.title,
          instructorName,
          categoryName,
        },
        icon: 'BookOpen',
      });
    } catch (err) {
      console.error('Failed to log module submission activity:', err);
    }

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

  // ── Admin: Approve ────────────────────────────────────────────────────────
  async approveModule(moduleId: string, adminId: string): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    module.status = ModuleStatus.APPROVED;
    module.approvedBy = new Types.ObjectId(adminId);
    module.approvedAt = new Date();

    return await module.save();
  }

  // ── Admin: Publish ────────────────────────────────────────────────────────
  async publishModule(moduleId: string, _adminId: string): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    module.status = ModuleStatus.PUBLISHED;
    module.publishedAt = new Date();

    return await module.save();
  }

  // ── Admin: Reject ─────────────────────────────────────────────────────────
  async rejectModule(
    moduleId: string,
    _adminId: string,
    rejectionReason: string,
  ): Promise<Module> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    module.status = ModuleStatus.REJECTED;
    module.rejectionReason = rejectionReason;

    return await module.save();
  }

  // ── Delete module (soft) ──────────────────────────────────────────────────
  async deleteModule(moduleId: string, instructorId: string): Promise<void> {
    const module = await this.moduleModel.findById(moduleId);
    if (!module) throw new NotFoundException('Module not found');

    if (!module.instructorIds.some((id) => id.toString() === instructorId)) {
      throw new UnauthorizedException('Not authorized');
    }

    module.isActive = false;''
    await module.save();
  }

  // ── Instructor stats ──────────────────────────────────────────────────────
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
          completedStudents: {
            $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] },
          },
          avgProgress: { $avg: '$overallProgress' },
        },
      },
    ]);

    const stats = enrollmentStats[0] || {
      totalStudents: 0,
      completedStudents: 0,
      avgProgress: 0,
    };

    const modulesByStatus = {
      draft: modules.filter((m) => m.status === ModuleStatus.DRAFT).length,
      submitted: modules.filter((m) => m.status === ModuleStatus.SUBMITTED)
        .length,
      approved: modules.filter((m) => m.status === ModuleStatus.APPROVED)
        .length,
      published: modules.filter((m) => m.status === ModuleStatus.PUBLISHED)
        .length,
      rejected: modules.filter((m) => m.status === ModuleStatus.REJECTED)
        .length,
    };

    let totalDurationMinutes = 0;
    for (const mod of modules) {
      const allLessons = this.getAllLessons(mod);
      for (const lesson of allLessons) {
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
      completionRate:
        stats.totalStudents > 0
          ? Math.round((stats.completedStudents / stats.totalStudents) * 100)
          : 0,
      avgProgress: Math.round(stats.avgProgress || 0),
      totalContentHours: Math.round((totalDurationMinutes / 60) * 10) / 10,
    };
  }

  // ── Download helpers ──────────────────────────────────────────────────────

  /** Strip HTML tags and decode common entities → plain text */
  private htmlToText(html: string): string {
    return (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Divider rule paragraph */
  private rule(): Paragraph {
    return new Paragraph({
      border: {
        bottom: { color: '021d49', size: 6, style: BorderStyle.SINGLE },
      },
      spacing: { after: 200 },
    });
  }

  /** Convert plain-text block (may contain \n) into Paragraph array */
  private textBlock(text: string, indent = 0): Paragraph[] {
    const lines = (text || '').split('\n');
    return lines.map(
      (line) =>
        new Paragraph({
          indent: indent ? { left: indent } : undefined,
          children: [new TextRun({ text: line, size: 22, font: 'Calibri' })],
          spacing: { after: 80 },
        }),
    );
  }

  /** Heading paragraph (H1–H3) */
  private heading(
    text: string,
    level: (typeof HeadingLevel)[keyof typeof HeadingLevel],
    color = '021d49',
  ): Paragraph {
    const sizes: Record<string, number> = {
      [HeadingLevel.HEADING_1]: 36,
      [HeadingLevel.HEADING_2]: 28,
      [HeadingLevel.HEADING_3]: 24,
    };
    return new Paragraph({
      children: [
        new TextRun({
          text,
          bold: true,
          color,
          size: sizes[level] ?? 24,
          font: 'Calibri',
        }),
      ],
      spacing: { before: 300, after: 150 },
    });
  }

  /** Label + value info row */
  private infoRow(label: string, value: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: `${label}: `,
          bold: true,
          size: 20,
          font: 'Calibri',
          color: '374151',
        }),
        new TextRun({
          text: value,
          size: 20,
          font: 'Calibri',
          color: '6b7280',
        }),
      ],
      spacing: { after: 80 },
    });
  }

  /** Shaded section-title banner */
  private sectionBanner(text: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: text.toUpperCase(),
          bold: true,
          size: 18,
          color: 'FFFFFF',
          font: 'Calibri',
        }),
      ],
      shading: { type: ShadingType.SOLID, color: '021d49', fill: '021d49' },
      spacing: { before: 200, after: 100 },
    });
  }

  /** Build a full DOCX Document for a single lesson */
  private async buildLessonDoc(
    lesson: any,
    lessonIndex: number,
    moduleTitle: string,
  ): Promise<Buffer> {
    const children: Paragraph[] = [];

    // Header
    children.push(
      this.heading(`${moduleTitle}`, HeadingLevel.HEADING_3, '6b7280'),
    );
    children.push(
      this.heading(
        `Lesson ${lessonIndex + 1}: ${lesson.title || ''}`,
        HeadingLevel.HEADING_1,
      ),
    );
    children.push(this.rule());

    if (lesson.duration)
      children.push(this.infoRow('Duration', lesson.duration));

    // Learning outcomes
    if ((lesson.learningOutcomes || []).length > 0) {
      children.push(this.sectionBanner('Learning Outcomes'));
      lesson.learningOutcomes.forEach((o: string) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `• ${o}`, size: 22, font: 'Calibri' }),
            ],
            spacing: { after: 80 },
          }),
        );
      });
    }

    // Description
    if (lesson.description) {
      children.push(this.sectionBanner('Description'));
      children.push(...this.textBlock(this.htmlToText(lesson.description)));
    }

    // Slides
    const slides = lesson.slides || [];
    if (slides.length > 0) {
      children.push(this.sectionBanner('Slides'));
    }

    slides.forEach((slide: any, si: number) => {
      // Slide heading
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Slide ${si + 1}`,
              bold: true,
              size: 26,
              color: '1e40af',
              font: 'Calibri',
            }),
          ],
          spacing: { before: 300, after: 100 },
          border: {
            bottom: { color: 'd1d5db', size: 2, style: BorderStyle.SINGLE },
          },
        }),
      );

      if (slide.sectionTitle) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: slide.sectionTitle,
                bold: true,
                italics: true,
                size: 22,
                color: '021d49',
                font: 'Calibri',
              }),
            ],
            spacing: { after: 100 },
          }),
        );
      }

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: (slide.type || 'content').toUpperCase(),
              size: 16,
              color: '9ca3af',
              font: 'Calibri',
              allCaps: true,
            }),
          ],
          spacing: { after: 80 },
        }),
      );

      const type = (slide.type || '').toLowerCase();

      if (type === 'text' || type === 'diagram') {
        children.push(...this.textBlock(this.htmlToText(slide.content || '')));
      } else if (type === 'image') {
        if (slide.imageUrl) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Image: ${slide.imageUrl}`,
                  size: 20,
                  color: '2563eb',
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 80 },
            }),
          );
        }
        if (slide.imageCaption) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: slide.imageCaption,
                  size: 20,
                  italics: true,
                  color: '6b7280',
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 80 },
            }),
          );
        }
      } else if (type === 'video') {
        if (slide.videoUrl) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Video: ${slide.videoUrl}`,
                  size: 20,
                  color: '2563eb',
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 80 },
            }),
          );
        }
        if (slide.videoCaption) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: slide.videoCaption,
                  size: 20,
                  italics: true,
                  color: '6b7280',
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 80 },
            }),
          );
        }
      } else if (type === 'codesnippet' || type === 'code_snippet') {
        if (slide.codeInstructions) {
          children.push(
            ...this.textBlock(this.htmlToText(slide.codeInstructions)),
          );
        }
        if (slide.starterCode) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Starter Code:',
                  bold: true,
                  size: 20,
                  font: 'Courier New',
                }),
              ],
              spacing: { after: 60 },
            }),
          );
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: slide.starterCode,
                  size: 18,
                  font: 'Courier New',
                  color: '1e293b',
                }),
              ],
              shading: {
                type: ShadingType.SOLID,
                color: 'f1f5f9',
                fill: 'f1f5f9',
              },
              spacing: { after: 120 },
            }),
          );
        }
        if (slide.expectedOutput) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Expected Output:',
                  bold: true,
                  size: 20,
                  font: 'Courier New',
                }),
              ],
              spacing: { after: 60 },
            }),
          );
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: slide.expectedOutput,
                  size: 18,
                  font: 'Courier New',
                  color: '166534',
                }),
              ],
              shading: {
                type: ShadingType.SOLID,
                color: 'f0fdf4',
                fill: 'f0fdf4',
              },
              spacing: { after: 120 },
            }),
          );
        }
      }
    });

    // Quiz
    const quiz = lesson.assessmentQuiz || [];
    if (quiz.length > 0) {
      children.push(this.sectionBanner('Lesson Quiz'));
      children.push(
        this.infoRow('Passing Score', `${lesson.quizPassingScore ?? 70}%`),
      );
      quiz.forEach((q: any, qi: number) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Q${qi + 1}. ${q.question || q.text || ''}`,
                bold: true,
                size: 22,
                font: 'Calibri',
              }),
            ],
            spacing: { before: 200, after: 80 },
          }),
        );
        (q.options || []).forEach((opt: string, oi: number) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `     ${String.fromCharCode(65 + oi)}. ${opt}`,
                  size: 20,
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 60 },
            }),
          );
        });
      });
    }

    // Lesson resources
    const resources = lesson.lessonResources || lesson.resources || [];
    if (resources.length > 0) {
      children.push(this.sectionBanner('Resources'));
      resources.forEach((r: any) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: r.name || 'Resource',
                bold: true,
                size: 20,
                font: 'Calibri',
              }),
              r.url
                ? new TextRun({
                    text: `  →  ${r.url}`,
                    size: 20,
                    color: '2563eb',
                    font: 'Calibri',
                  })
                : new TextRun(''),
            ],
            spacing: { after: 80 },
          }),
        );
      });
    }

    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
  }

  // ── PowerPoint builder ────────────────────────────────────────────────────

  /** Build a .pptx file for a single lesson — one PowerPoint slide per content slide */
  private async buildLessonPptx(
    lesson: any,
    lessonIndex: number,
    moduleTitle: string,
  ): Promise<Buffer> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

    const NAVY = '021d49';
    const WHITE = 'FFFFFF';
    const SLATE = '475569';
    const BLUE = '1e40af';
    const GRAY = 'f1f5f9';
    const LGRAY = 'e2e8f0';

    // ── Title slide ────────────────────────────────────────────────────────
    const titleSlide = pptx.addSlide();
    // Full navy background
    titleSlide.background = { color: NAVY };
    // Module subtitle
    titleSlide.addText(moduleTitle, {
      x: 0.5,
      y: 1.2,
      w: 12.3,
      h: 0.5,
      fontSize: 14,
      color: '93c5fd',
      align: 'center',
      italic: true,
    });
    // Lesson title
    titleSlide.addText(`Lesson ${lessonIndex + 1}: ${lesson.title || ''}`, {
      x: 0.5,
      y: 1.9,
      w: 12.3,
      h: 1.4,
      fontSize: 34,
      bold: true,
      color: WHITE,
      align: 'center',
      wrap: true,
    });
    // Meta strip
    const meta = [
      lesson.duration ? `⏱ ${lesson.duration}` : null,
      (lesson.slides || []).length ? `📄 ${lesson.slides.length} slides` : null,
    ]
      .filter(Boolean)
      .join('   ·   ');
    if (meta) {
      titleSlide.addText(meta, {
        x: 0.5,
        y: 3.5,
        w: 12.3,
        h: 0.4,
        fontSize: 13,
        color: '93c5fd',
        align: 'center',
      });
    }
    // Learning outcomes
    if ((lesson.learningOutcomes || []).length > 0) {
      titleSlide.addText('Learning Outcomes', {
        x: 1.5,
        y: 4.2,
        w: 10.3,
        h: 0.4,
        fontSize: 13,
        bold: true,
        color: '93c5fd',
      });
      const outcomeText = lesson.learningOutcomes.map((o: string) => ({
        text: `• ${o}\n`,
      }));
      titleSlide.addText(outcomeText, {
        x: 1.5,
        y: 4.7,
        w: 10.3,
        h: 2.0,
        fontSize: 12,
        color: 'cbd5e1',
        wrap: true,
        valign: 'top',
      });
    }

    // ── Content slides ─────────────────────────────────────────────────────
    const slides = lesson.slides || [];
    for (let si = 0; si < slides.length; si++) {
      const slide = slides[si];
      const type = (slide.type || 'text').toLowerCase();
      const pSlide = pptx.addSlide();

      // White background
      pSlide.background = { color: WHITE };

      // Top navy header bar
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: '100%',
        h: 1.0,
        fill: { color: NAVY },
        line: { color: NAVY },
      });

      // Slide number badge
      pSlide.addText(`${si + 1} / ${slides.length}`, {
        x: 11.8,
        y: 0.12,
        w: 1.0,
        h: 0.35,
        fontSize: 10,
        color: '93c5fd',
        align: 'right',
      });

      // Type label
      pSlide.addText(type.replace('_', ' ').toUpperCase(), {
        x: 0.3,
        y: 0.1,
        w: 3,
        h: 0.35,
        fontSize: 10,
        color: 'bfdbfe',
        bold: true,
      });

      // Section title (if set)
      if (slide.sectionTitle) {
        pSlide.addText(slide.sectionTitle, {
          x: 0.3,
          y: 0.6,
          w: 12,
          h: 0.5,
          fontSize: 16,
          bold: true,
          italic: true,
          color: WHITE,
        });
      }

      // Content area Y start (below header)
      const contentY = 1.15;
      const contentH = 5.9;

      if (type === 'text' || type === 'diagram') {
        const text = this.htmlToText(slide.content || '');
        pSlide.addText(text, {
          x: 0.5,
          y: contentY,
          w: 12.3,
          h: contentH,
          fontSize: 14,
          color: '1f2937',
          wrap: true,
          valign: 'top',
          paraSpaceAfter: 6,
        });
      } else if (type === 'image') {
        if (slide.imageUrl) {
          // Try local file first
          const localPath =
            slide.imageUrl.startsWith('uploads/') ||
            slide.imageUrl.startsWith('./uploads/')
              ? path.join(process.cwd(), slide.imageUrl.replace(/^\.\//, ''))
              : null;
          if (localPath && fs.existsSync(localPath)) {
            pSlide.addImage({
              path: localPath,
              x: 1.5,
              y: contentY,
              w: 10,
              h: 4.5,
              sizing: { type: 'contain', w: 10, h: 4.5 },
            });
          } else if (slide.imageUrl.startsWith('http')) {
            try {
              pSlide.addImage({
                path: slide.imageUrl,
                x: 1.5,
                y: contentY,
                w: 10,
                h: 4.5,
                sizing: { type: 'contain', w: 10, h: 4.5 },
              });
            } catch {
              /* skip if fetch fails */
            }
          }
        }
        if (slide.imageCaption) {
          pSlide.addText(slide.imageCaption, {
            x: 0.5,
            y: 5.9,
            w: 12.3,
            h: 0.5,
            fontSize: 11,
            italic: true,
            color: SLATE,
            align: 'center',
          });
        }
      } else if (type === 'video') {
        pSlide.addShape(pptx.ShapeType.rect, {
          x: 2,
          y: contentY,
          w: 9.3,
          h: 4.2,
          fill: { color: '1e293b' },
          line: { color: '334155' },
        });
        pSlide.addText('▶', {
          x: 5.7,
          y: contentY + 1.3,
          w: 2,
          h: 1.5,
          fontSize: 48,
          color: WHITE,
          align: 'center',
        });
        if (slide.videoUrl) {
          pSlide.addText(slide.videoUrl, {
            x: 0.5,
            y: contentY + 4.4,
            w: 12.3,
            h: 0.4,
            fontSize: 11,
            color: BLUE,
            align: 'center',
            hyperlink: { url: slide.videoUrl },
          });
        }
        if (slide.videoCaption) {
          pSlide.addText(slide.videoCaption, {
            x: 0.5,
            y: contentY + 4.9,
            w: 12.3,
            h: 0.4,
            fontSize: 11,
            italic: true,
            color: SLATE,
            align: 'center',
          });
        }
      } else if (type === 'codesnippet' || type === 'code_snippet') {
        let yOffset = contentY;
        if (slide.codeInstructions) {
          const instr = this.htmlToText(slide.codeInstructions);
          pSlide.addText(instr, {
            x: 0.5,
            y: yOffset,
            w: 12.3,
            h: 1.0,
            fontSize: 13,
            color: '1f2937',
            wrap: true,
          });
          yOffset += 1.1;
        }
        if (slide.starterCode) {
          pSlide.addShape(pptx.ShapeType.rect, {
            x: 0.5,
            y: yOffset,
            w: 12.3,
            h: 2.6,
            fill: { color: '1e293b' },
            line: { color: '334155' },
          });
          pSlide.addText(slide.starterCode, {
            x: 0.7,
            y: yOffset + 0.1,
            w: 12.0,
            h: 2.4,
            fontSize: 11,
            fontFace: 'Courier New',
            color: 'e2e8f0',
            wrap: true,
            valign: 'top',
          });
          yOffset += 2.8;
        }
        if (slide.expectedOutput) {
          pSlide.addText('Expected Output:', {
            x: 0.5,
            y: yOffset,
            w: 12.3,
            h: 0.35,
            fontSize: 11,
            bold: true,
            color: '166534',
          });
          pSlide.addShape(pptx.ShapeType.rect, {
            x: 0.5,
            y: yOffset + 0.4,
            w: 12.3,
            h: 0.9,
            fill: { color: 'f0fdf4' },
            line: { color: 'bbf7d0' },
          });
          pSlide.addText(slide.expectedOutput, {
            x: 0.7,
            y: yOffset + 0.45,
            w: 12.0,
            h: 0.8,
            fontSize: 11,
            fontFace: 'Courier New',
            color: '166534',
            wrap: true,
          });
        }
      }
    }

    // ── Quiz slide ─────────────────────────────────────────────────────────
    const quiz = lesson.assessmentQuiz || [];
    if (quiz.length > 0) {
      const qSlide = pptx.addSlide();
      qSlide.background = { color: GRAY };
      qSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: '100%',
        h: 1.0,
        fill: { color: '4c1d95' },
        line: { color: '4c1d95' },
      });
      qSlide.addText('LESSON QUIZ', {
        x: 0.3,
        y: 0.1,
        w: 8,
        h: 0.35,
        fontSize: 10,
        color: 'e9d5ff',
        bold: true,
      });
      qSlide.addText(
        `${quiz.length} question${quiz.length !== 1 ? 's' : ''}   ·   Pass: ${lesson.quizPassingScore ?? 70}%`,
        {
          x: 0.3,
          y: 0.5,
          w: 12,
          h: 0.4,
          fontSize: 14,
          color: WHITE,
          bold: true,
        },
      );

      let qy = 1.15;
      quiz.slice(0, 4).forEach((q: any, qi: number) => {
        qSlide.addText(`Q${qi + 1}. ${q.question || q.text || ''}`, {
          x: 0.4,
          y: qy,
          w: 12.5,
          h: 0.45,
          fontSize: 13,
          bold: true,
          color: '1f2937',
          wrap: true,
        });
        qy += 0.5;
        (q.options || []).slice(0, 4).forEach((opt: string, oi: number) => {
          qSlide.addText(`   ${String.fromCharCode(65 + oi)}. ${opt}`, {
            x: 0.4,
            y: qy,
            w: 12.5,
            h: 0.35,
            fontSize: 12,
            color: SLATE,
          });
          qy += 0.38;
        });
        qy += 0.2;
      });
    }

    // ── Summary / end slide ─────────────────────────────────────────────────
    const endSlide = pptx.addSlide();
    endSlide.background = { color: NAVY };
    endSlide.addText('End of Lesson', {
      x: 0.5,
      y: 2.5,
      w: 12.3,
      h: 1.0,
      fontSize: 32,
      bold: true,
      color: WHITE,
      align: 'center',
    });
    endSlide.addText(lesson.title || '', {
      x: 0.5,
      y: 3.6,
      w: 12.3,
      h: 0.5,
      fontSize: 16,
      color: '93c5fd',
      align: 'center',
      italic: true,
    });

    return pptx.write({ outputType: 'nodebuffer' }) as Promise<Buffer>;
  }

  /** Build module overview DOCX */
  private async buildOverviewDoc(mod: any): Promise<Buffer> {
    const children: Paragraph[] = [];

    children.push(
      this.heading(mod.title || 'Module Overview', HeadingLevel.HEADING_1),
    );
    children.push(this.rule());

    if (mod.level) children.push(this.infoRow('Level', mod.level));
    if (mod.duration) children.push(this.infoRow('Duration', mod.duration));
    if ((mod.lessons || []).length)
      children.push(this.infoRow('Lessons', String(mod.lessons.length)));

    if (mod.description) {
      children.push(this.sectionBanner('Description'));
      children.push(...this.textBlock(this.htmlToText(mod.description)));
    }
    if (mod.learningObjectives) {
      children.push(this.sectionBanner('Learning Objectives'));
      children.push(...this.textBlock(this.htmlToText(mod.learningObjectives)));
    }
    if (mod.learningOutcomes) {
      children.push(this.sectionBanner('Learning Outcomes'));
      children.push(...this.textBlock(this.htmlToText(mod.learningOutcomes)));
    }
    if (mod.moduleTopics) {
      children.push(this.sectionBanner('Module Topics'));
      children.push(...this.textBlock(this.htmlToText(mod.moduleTopics)));
    }
    if (mod.capstone) {
      children.push(this.sectionBanner('Capstone Project'));
      children.push(...this.textBlock(this.htmlToText(mod.capstone)));
    }
    if (mod.coreReadingMaterials) {
      children.push(this.sectionBanner('Core Reading Materials'));
      children.push(
        ...this.textBlock(this.htmlToText(mod.coreReadingMaterials)),
      );
    }
    if ((mod.prerequisites || []).length) {
      children.push(this.sectionBanner('Prerequisites'));
      mod.prerequisites.forEach((p: string) =>
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `• ${p}`, size: 22, font: 'Calibri' }),
            ],
            spacing: { after: 80 },
          }),
        ),
      );
    }
    if ((mod.targetAudience || []).length) {
      children.push(this.sectionBanner('Target Audience'));
      mod.targetAudience.forEach((a: string) =>
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `• ${a}`, size: 22, font: 'Calibri' }),
            ],
            spacing: { after: 80 },
          }),
        ),
      );
    }

    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
  }

  // ── Download module as ZIP ────────────────────────────────────────────────

  async downloadModule(moduleId: string, res: Response): Promise<void> {
    const mod = await this.moduleModel.findById(moduleId).lean().exec();
    if (!mod) throw new NotFoundException('Module not found');

    const safe = (s: string, max = 60) =>
      (s || 'untitled')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, max);

    const root = safe(mod.title || 'Module');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${root}.zip"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    const archive = archiver.default('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => res.destroy(err));
    archive.pipe(res);

    // ── Module overview.docx ──────────────────────────────────────────────────
    const overviewBuf = await this.buildOverviewDoc(mod);
    archive.append(overviewBuf, { name: `${root}/overview.docx` });

    // ── Module resources.docx ─────────────────────────────────────────────────
    const modResources: any[] = (mod as any).moduleResources || [];
    if (modResources.length > 0) {
      const resChildren: Paragraph[] = [
        this.heading('Module Resources', HeadingLevel.HEADING_1),
        this.rule(),
      ];
      modResources.forEach((r) => {
        resChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: r.name || 'Resource',
                bold: true,
                size: 22,
                font: 'Calibri',
              }),
            ],
            spacing: { before: 200, after: 60 },
          }),
        );
        if (r.description) resChildren.push(...this.textBlock(r.description));
        if (r.url)
          resChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: r.url,
                  size: 20,
                  color: '2563eb',
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 80 },
            }),
          );
      });
      const resDoc = new Document({ sections: [{ children: resChildren }] });
      archive.append(await Packer.toBuffer(resDoc), {
        name: `${root}/resources.docx`,
      });
    }

    // ── Lessons — one .pptx per lesson ───────────────────────────────────────
    const lessons: any[] = (mod as any).lessons || [];
    for (let li = 0; li < lessons.length; li++) {
      const lesson = lessons[li];
      const lessonFolder = `${root}/Lesson ${String(li + 1).padStart(2, '0')} - ${safe(lesson.title || `Lesson ${li + 1}`)}`;
      const lessonBuf = await this.buildLessonPptx(
        lesson,
        li,
        mod.title || 'Module',
      );
      archive.append(lessonBuf, { name: `${lessonFolder}/slides.pptx` });

      // Include local media files alongside the docx
      const slides: any[] = lesson.slides || [];
      for (const slide of slides) {
        if (slide.imageUrl) {
          const localPath =
            slide.imageUrl.startsWith('uploads/') ||
            slide.imageUrl.startsWith('./uploads/')
              ? path.join(process.cwd(), slide.imageUrl.replace(/^\.\//, ''))
              : null;
          if (localPath && fs.existsSync(localPath)) {
            archive.file(localPath, {
              name: `${lessonFolder}/media/${path.basename(localPath)}`,
            });
          }
        }
      }
    }

    // ── Final Assessment.docx ─────────────────────────────────────────────────
    const fa: any = (mod as any).finalAssessment;
    if (fa && (fa.questions || []).length > 0) {
      const faChildren: Paragraph[] = [
        this.heading(
          `Final Assessment: ${fa.title || ''}`,
          HeadingLevel.HEADING_1,
        ),
        this.rule(),
      ];
      if (fa.instructions) faChildren.push(...this.textBlock(fa.instructions));
      faChildren.push(
        this.infoRow('Passing Score', `${fa.passingScore ?? 70}%`),
      );
      faChildren.push(
        this.infoRow('Max Attempts', String(fa.maxAttempts ?? 3)),
      );
      if (fa.timeLimit)
        faChildren.push(this.infoRow('Time Limit', `${fa.timeLimit} minutes`));
      faChildren.push(this.sectionBanner('Questions'));
      (fa.questions || []).forEach((q: any, qi: number) => {
        faChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Q${qi + 1}. ${q.text || q.question || ''}`,
                bold: true,
                size: 22,
                font: 'Calibri',
              }),
            ],
            spacing: { before: 200, after: 80 },
          }),
        );
        (q.options || []).forEach((opt: string, oi: number) => {
          faChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `     ${String.fromCharCode(65 + oi)}. ${opt}`,
                  size: 20,
                  font: 'Calibri',
                }),
              ],
              spacing: { after: 60 },
            }),
          );
        });
      });
      const faDoc = new Document({ sections: [{ children: faChildren }] });
      archive.append(await Packer.toBuffer(faDoc), {
        name: `${root}/final-assessment.docx`,
      });
    }

    await archive.finalize();
  }
}
