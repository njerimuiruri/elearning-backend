import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ModuleRatingsService } from './module-ratings.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('module-ratings')
export class ModuleRatingsController {
  constructor(private readonly ratingsService: ModuleRatingsService) {}

  // ── Student: submit or update a rating ─────────────────────────────────────
  // POST /module-ratings/:moduleId
  @Post(':moduleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async submitRating(
    @Param('moduleId') moduleId: string,
    @Body() dto: SubmitRatingDto,
    @Request() req,
  ) {
    const rating = await this.ratingsService.submitRating(
      req.user.id,
      moduleId,
      dto,
    );
    return { success: true, data: rating };
  }

  // ── Student: get own rating for a module ───────────────────────────────────
  // GET /module-ratings/my/:moduleId
  @Get('my/:moduleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getMyRating(@Param('moduleId') moduleId: string, @Request() req) {
    const rating = await this.ratingsService.getMyRating(req.user.id, moduleId);
    return { success: true, data: rating };
  }

  // ── Instructor: rating analytics for own modules ───────────────────────────
  // GET /module-ratings/instructor/analytics
  @Get('instructor/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorAnalytics(@Request() req) {
    const data = await this.ratingsService.getInstructorRatingAnalytics(
      req.user.id,
    );
    return { success: true, data };
  }

  // ── Admin: rating analytics for all published modules ──────────────────────
  // GET /module-ratings/admin/analytics
  @Get('admin/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAdminAnalytics(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: 'avgRating' | 'totalRatings' | 'title',
  ) {
    const data = await this.ratingsService.getAdminRatingAnalytics(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      sortBy || 'avgRating',
    );
    return { success: true, data };
  }

  // ── Public: summary stats (avg + distribution) for a module ───────────────
  // GET /module-ratings/:moduleId/summary
  @Get(':moduleId/summary')
  async getModuleSummary(@Param('moduleId') moduleId: string) {
    const data = await this.ratingsService.getModuleSummary(moduleId);
    return { success: true, data };
  }

  // ── Instructor / Admin: paginated reviews for a module ────────────────────
  // GET /module-ratings/:moduleId/reviews
  @Get(':moduleId/reviews')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  async getModuleReviews(
    @Param('moduleId') moduleId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.ratingsService.getModuleReviews(
      moduleId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
    return { success: true, data };
  }
}
