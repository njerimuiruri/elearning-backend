import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ModulesService } from './modules.service';
import {
  CreateModuleDto,
  CreateModuleLessonDto,
  CreateLessonDto,
  FinalAssessmentDto,
  SlideDto,
} from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { ModuleLevel } from '../schemas/module.schema';

@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  // ── Create new module (instructor) ───────────────────────────────────────
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async createModule(@Request() req, @Body() createModuleDto: CreateModuleDto) {
    return await this.modulesService.createModule(req.user.id, createModuleDto);
  }

  // ── Get all published modules with filters ────────────────────────────────
  @Get()
  async getAllPublishedModules(
    @Query('category') category?: string,
    @Query('level') level?: ModuleLevel,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.modulesService.getAllPublishedModules({
      category,
      level,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // ── Get instructor's modules ──────────────────────────────────────────────
  @Get('instructor/my-modules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorModules(@Request() req) {
    return await this.modulesService.getInstructorModules(req.user.id);
  }

  // ── Get instructor's module stats ─────────────────────────────────────────
  @Get('instructor/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorModuleStats(@Request() req) {
    return await this.modulesService.getInstructorModuleStats(req.user.id);
  }

  // ── Get modules by category and level ────────────────────────────────────
  @Get('category/:categoryId/level/:level')
  async getModulesByLevelAndCategory(
    @Param('categoryId') categoryId: string,
    @Param('level') level: ModuleLevel,
  ) {
    return await this.modulesService.getModulesByLevelAndCategory(
      categoryId,
      level,
    );
  }

  // ── Get module by ID ──────────────────────────────────────────────────────
  // ── Download module as ZIP ────────────────────────────────────────────────
  @Get(':id/download')
  @UseGuards(JwtAuthGuard)
  async downloadModule(@Param('id') id: string, @Res() res: Response) {
    return await this.modulesService.downloadModule(id, res);
  }

  @Get(':id')
  async getModuleById(@Param('id') id: string) {
    return await this.modulesService.getModuleById(id);
  }

  // ── Update module metadata ────────────────────────────────────────────────
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async updateModule(
    @Param('id') id: string,
    @Request() req,
    @Body() updateModuleDto: UpdateModuleDto,
  ) {
    return await this.modulesService.updateModule(
      id,
      req.user.id,
      updateModuleDto,
    );
  }

  // ── Finalize content (unlocks Final Assessment for students) ─────────────
  @Put(':id/finalize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async finalizeContent(@Param('id') id: string, @Request() req) {
    return await this.modulesService.finalizeContent(id, req.user.id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIRECT LESSON ENDPOINTS (Category → Module → Lesson)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Add lesson directly to module ────────────────────────────────────────
  @Post(':id/lessons')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async addModuleLesson(
    @Param('id') id: string,
    @Request() req,
    @Body() lessonData: CreateModuleLessonDto,
  ) {
    return await this.modulesService.addModuleLesson(
      id,
      req.user.id,
      lessonData,
    );
  }

  // ── Update a lesson ───────────────────────────────────────────────────────
  @Put(':id/lessons/:lessonIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async updateModuleLesson(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
    @Body() lessonData: CreateModuleLessonDto,
  ) {
    return await this.modulesService.updateModuleLesson(
      id,
      parseInt(lessonIndex),
      req.user.id,
      lessonData,
    );
  }

  // ── Delete a lesson ───────────────────────────────────────────────────────
  @Delete(':id/lessons/:lessonIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async deleteModuleLesson(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
  ) {
    return await this.modulesService.deleteModuleLesson(
      id,
      parseInt(lessonIndex),
      req.user.id,
    );
  }

  // ── Reorder lessons ───────────────────────────────────────────────────────
  @Put(':id/lessons/reorder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async reorderLessons(
    @Param('id') id: string,
    @Request() req,
    @Body()
    body: { lessonOrders: Array<{ lessonIndex: number; order: number }> },
  ) {
    return await this.modulesService.reorderLessons(
      id,
      req.user.id,
      body.lessonOrders,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SLIDE ENDPOINTS (inside a lesson)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Add slide to a lesson ─────────────────────────────────────────────────
  @Post(':id/lessons/:lessonIndex/slides')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async addSlide(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
    @Body() slideData: SlideDto,
  ) {
    return await this.modulesService.addSlide(
      id,
      parseInt(lessonIndex),
      req.user.id,
      slideData,
    );
  }

  // ── Update a slide ────────────────────────────────────────────────────────
  @Put(':id/lessons/:lessonIndex/slides/:slideIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async updateSlide(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @Param('slideIndex') slideIndex: string,
    @Request() req,
    @Body() slideData: SlideDto,
  ) {
    return await this.modulesService.updateSlide(
      id,
      parseInt(lessonIndex),
      parseInt(slideIndex),
      req.user.id,
      slideData,
    );
  }

  // ── Delete a slide ────────────────────────────────────────────────────────
  @Delete(':id/lessons/:lessonIndex/slides/:slideIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async deleteSlide(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @Param('slideIndex') slideIndex: string,
    @Request() req,
  ) {
    return await this.modulesService.deleteSlide(
      id,
      parseInt(lessonIndex),
      parseInt(slideIndex),
      req.user.id,
    );
  }

  // ── Reorder slides within a lesson ────────────────────────────────────────
  @Put(':id/lessons/:lessonIndex/slides/reorder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async reorderSlides(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
    @Body() body: { slideOrders: Array<{ slideIndex: number; order: number }> },
  ) {
    return await this.modulesService.reorderSlides(
      id,
      parseInt(lessonIndex),
      req.user.id,
      body.slideOrders,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY TOPIC ENDPOINTS (kept for backward compat)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Delete entire topic ───────────────────────────────────────────────────
  @Delete(':id/topics/:topicIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async deleteTopic(
    @Param('id') id: string,
    @Param('topicIndex') topicIndex: string,
    @Request() req,
  ) {
    return await this.modulesService.deleteTopic(
      id,
      parseInt(topicIndex),
      req.user.id,
    );
  }

  // ── Add lesson to a specific topic (legacy) ───────────────────────────────
  @Post(':id/topics/:topicIndex/lessons')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async addLesson(
    @Param('id') id: string,
    @Param('topicIndex') topicIndex: string,
    @Request() req,
    @Body() lessonData: CreateLessonDto,
  ) {
    return await this.modulesService.addLesson(
      id,
      req.user.id,
      parseInt(topicIndex),
      lessonData,
    );
  }

  // ── Update lesson inside a topic (legacy) ─────────────────────────────────
  @Put(':id/topics/:topicIndex/lessons/:lessonIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async updateLesson(
    @Param('id') id: string,
    @Param('topicIndex') topicIndex: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
    @Body() lessonData: CreateLessonDto,
  ) {
    return await this.modulesService.updateLesson(
      id,
      parseInt(topicIndex),
      parseInt(lessonIndex),
      req.user.id,
      lessonData,
    );
  }

  // ── Delete lesson from a topic (legacy) ───────────────────────────────────
  @Delete(':id/topics/:topicIndex/lessons/:lessonIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async deleteLesson(
    @Param('id') id: string,
    @Param('topicIndex') topicIndex: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
  ) {
    return await this.modulesService.deleteLesson(
      id,
      parseInt(topicIndex),
      parseInt(lessonIndex),
      req.user.id,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ASSESSMENT ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Set final assessment ──────────────────────────────────────────────────
  @Post(':id/final-assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async setFinalAssessment(
    @Param('id') id: string,
    @Request() req,
    @Body() assessmentData: FinalAssessmentDto,
  ) {
    return await this.modulesService.setFinalAssessment(
      id,
      req.user.id,
      assessmentData,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WORKFLOW ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async submitForApproval(@Param('id') id: string, @Request() req) {
    return await this.modulesService.submitForApproval(id, req.user.id);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async approveModule(@Param('id') id: string, @Request() req) {
    return await this.modulesService.approveModule(id, req.user.id);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async publishModule(@Param('id') id: string, @Request() req) {
    return await this.modulesService.publishModule(id, req.user.id);
  }

  // ── Bulk-publish all admin-created DRAFT modules ──────────────────────────
  @Post('admin/publish-all-drafts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async publishAllAdminDrafts() {
    return await this.modulesService.publishAllAdminDraftModules();
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async rejectModule(
    @Param('id') id: string,
    @Request() req,
    @Body('rejectionReason') rejectionReason: string,
  ) {
    return await this.modulesService.rejectModule(
      id,
      req.user.id,
      rejectionReason,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  async deleteModule(@Param('id') id: string, @Request() req) {
    return await this.modulesService.deleteModule(id, req.user.id);
  }
}
