import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ModuleRating } from '../schemas/module-rating.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { SubmitRatingDto } from './dto/submit-rating.dto';

@Injectable()
export class ModuleRatingsService {
  constructor(
    @InjectModel(ModuleRating.name)
    private ratingModel: Model<ModuleRating>,

    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,

    @InjectModel('Module')
    private moduleModel: Model<any>,
  ) {}

  // ── Student: submit or update a rating ─────────────────────────────────────
  async submitRating(
    studentId: string,
    moduleId: string,
    dto: SubmitRatingDto,
  ) {
    if (!Types.ObjectId.isValid(moduleId)) {
      throw new NotFoundException('Module not found');
    }

    // Must have a completed enrollment
    const enrollment = await this.enrollmentModel.findOne({
      studentId: new Types.ObjectId(studentId),
      moduleId: new Types.ObjectId(moduleId),
      isCompleted: true,
    });

    if (!enrollment) {
      throw new ForbiddenException(
        'You must complete this module before rating it.',
      );
    }

    // Upsert: one rating per student per module (editable)
    const existing = await this.ratingModel.findOneAndUpdate(
      {
        studentId: new Types.ObjectId(studentId),
        moduleId: new Types.ObjectId(moduleId),
      },
      {
        $set: {
          rating: dto.rating,
          review: dto.review ?? '',
        },
      },
      { upsert: true, new: true },
    );

    // Recalculate and persist module stats
    await this.recalculateModuleStats(moduleId);

    return existing;
  }

  // ── Student: get own rating for a module ───────────────────────────────────
  async getMyRating(studentId: string, moduleId: string) {
    if (!Types.ObjectId.isValid(moduleId)) return null;
    return this.ratingModel.findOne({
      studentId: new Types.ObjectId(studentId),
      moduleId: new Types.ObjectId(moduleId),
    });
  }

  // ── Public / Instructor / Admin: get summary stats for a module ─────────────
  async getModuleSummary(moduleId: string) {
    if (!Types.ObjectId.isValid(moduleId)) {
      throw new NotFoundException('Module not found');
    }

    const [stats, distribution] = await Promise.all([
      this.ratingModel.aggregate([
        { $match: { moduleId: new Types.ObjectId(moduleId) } },
        {
          $group: {
            _id: null,
            avg: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.ratingModel.aggregate([
        { $match: { moduleId: new Types.ObjectId(moduleId) } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
      ]),
    ]);

    const avgRating = stats.length > 0 ? Math.round(stats[0].avg * 10) / 10 : 0;
    const totalRatings = stats.length > 0 ? stats[0].count : 0;

    // Build 5-1 star distribution object
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    distribution.forEach((d) => {
      dist[d._id] = d.count;
    });

    return { avgRating, totalRatings, distribution: dist };
  }

  // ── Instructor / Admin: get paginated reviews for a module ──────────────────
  async getModuleReviews(moduleId: string, page = 1, limit = 20) {
    if (!Types.ObjectId.isValid(moduleId)) {
      throw new NotFoundException('Module not found');
    }

    const skip = (page - 1) * limit;
    const [reviews, total] = await Promise.all([
      this.ratingModel
        .find({ moduleId: new Types.ObjectId(moduleId) })
        .populate('studentId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.ratingModel.countDocuments({
        moduleId: new Types.ObjectId(moduleId),
      }),
    ]);

    return {
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // ── Instructor: get rating analytics for all their modules ─────────────────
  async getInstructorRatingAnalytics(instructorId: string) {
    // Find all modules belonging to this instructor
    const modules = await this.moduleModel
      .find({ instructorIds: new Types.ObjectId(instructorId) })
      .select('_id title avgRating totalRatings level status')
      .lean();

    if (modules.length === 0) return [];

    const moduleIds = modules.map((m) => m._id);

    // Get aggregated stats per module
    const stats = await this.ratingModel.aggregate([
      { $match: { moduleId: { $in: moduleIds } } },
      {
        $group: {
          _id: '$moduleId',
          avg: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    const statsMap = new Map(
      stats.map((s) => [
        s._id.toString(),
        { avgRating: Math.round(s.avg * 10) / 10, totalRatings: s.count },
      ]),
    );

    return modules.map((mod) => {
      const id = (mod._id as any).toString();
      return {
        moduleId: mod._id,
        title: mod.title,
        level: mod.level,
        status: mod.status,
        avgRating: statsMap.get(id)?.avgRating ?? 0,
        totalRatings: statsMap.get(id)?.totalRatings ?? 0,
      };
    });
  }

  // ── Admin: get rating analytics for all published modules ──────────────────
  async getAdminRatingAnalytics(
    page = 1,
    limit = 20,
    sortBy: 'avgRating' | 'totalRatings' | 'title' = 'avgRating',
  ) {
    const skip = (page - 1) * limit;

    const sort: Record<string, 1 | -1> = {};
    sort[sortBy === 'title' ? 'title' : sortBy] = sortBy === 'title' ? 1 : -1;

    const [modules, total] = await Promise.all([
      this.moduleModel
        .find({ status: 'published' })
        .select('_id title avgRating totalRatings level enrollmentCount')
        .populate('instructorIds', 'firstName lastName')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      this.moduleModel.countDocuments({ status: 'published' }),
    ]);

    return {
      modules,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // ── Internal: recalculate and persist avgRating + totalRatings on Module ───
  private async recalculateModuleStats(moduleId: string) {
    const stats = await this.ratingModel.aggregate([
      { $match: { moduleId: new Types.ObjectId(moduleId) } },
      {
        $group: {
          _id: null,
          avg: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    const avgRating = stats.length > 0 ? Math.round(stats[0].avg * 10) / 10 : 0;
    const totalRatings = stats.length > 0 ? stats[0].count : 0;

    await this.moduleModel.findByIdAndUpdate(moduleId, {
      avgRating,
      totalRatings,
    });
  }
}
