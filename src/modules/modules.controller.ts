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
} from '@nestjs/common';
import { ModulesService } from './modules.service';
import { CreateModuleDto, CreateLessonDto, FinalAssessmentDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { ModuleLevel } from '../schemas/module.schema';

@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  // Create new module (instructor)
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async createModule(@Request() req, @Body() createModuleDto: CreateModuleDto) {
    return await this.modulesService.createModule(
      req.user.id,
      createModuleDto,
    );
  }

  // Get all published modules with filters
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

  // Get instructor's modules
  @Get('instructor/my-modules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorModules(@Request() req) {
    return await this.modulesService.getInstructorModules(req.user.id);
  }

  // Get instructor's module stats
  @Get('instructor/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorModuleStats(@Request() req) {
    return await this.modulesService.getInstructorModuleStats(req.user.id);
  }

  // Get modules by category and level
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

  // Get module by ID
  @Get(':id')
  async getModuleById(@Param('id') id: string) {
    return await this.modulesService.getModuleById(id);
  }

  // Update module
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

  // Delete entire topic
  @Delete(':id/topics/:topicIndex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async deleteTopic(
    @Param('id') id: string,
    @Param('topicIndex') topicIndex: string,
    @Request() req,
  ) {
    return await this.modulesService.deleteTopic(id, parseInt(topicIndex), req.user.id);
  }

  // Add lesson to a specific topic
  @Post(':id/topics/:topicIndex/lessons')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async addLesson(
    @Param('id') id: string,
    @Param('topicIndex') topicIndex: string,
    @Request() req,
    @Body() lessonData: CreateLessonDto,
  ) {
    return await this.modulesService.addLesson(id, req.user.id, parseInt(topicIndex), lessonData);
  }

  // Update lesson inside a topic
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

  // Delete lesson from a topic
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

  // Set final assessment
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

  // Submit for approval
  @Post(':id/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async submitForApproval(@Param('id') id: string, @Request() req) {
    return await this.modulesService.submitForApproval(id, req.user.id);
  }

  // Approve module (admin)
  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async approveModule(@Param('id') id: string, @Request() req) {
    return await this.modulesService.approveModule(id, req.user.id);
  }

  // Publish module (admin)
  @Post(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async publishModule(@Param('id') id: string, @Request() req) {
    return await this.modulesService.publishModule(id, req.user.id);
  }

  // Reject module (admin)
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

  // Delete module
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  async deleteModule(@Param('id') id: string, @Request() req) {
    return await this.modulesService.deleteModule(id, req.user.id);
  }
}
