import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ModuleEnrollmentsService } from './module-enrollments.service';
import { SubmitFinalAssessmentDto, SubmitLessonAssessmentDto } from './dto/submit-assessment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('module-enrollments')
export class ModuleEnrollmentsController {
  constructor(
    private readonly enrollmentsService: ModuleEnrollmentsService,
  ) {}

  // Enroll in module
  @Post('modules/:moduleId/enroll')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async enrollInModule(@Param('moduleId') moduleId: string, @Request() req) {
    return await this.enrollmentsService.enrollInModule(req.user.id, moduleId);
  }

  // Get student's enrollments
  @Get('my-enrollments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getMyEnrollments(@Request() req) {
    return await this.enrollmentsService.getStudentEnrollments(req.user.id);
  }

  // Get enrollment by student and module
  @Get('modules/:moduleId/my-enrollment')
  @UseGuards(JwtAuthGuard)
  async getMyEnrollmentForModule(
    @Param('moduleId') moduleId: string,
    @Request() req,
  ) {
    return await this.enrollmentsService.getEnrollmentByStudentAndModule(
      req.user.id,
      moduleId,
    );
  }

  // Get enrollment details
  @Get(':enrollmentId')
  @UseGuards(JwtAuthGuard)
  async getEnrollmentById(@Param('enrollmentId') enrollmentId: string) {
    return await this.enrollmentsService.getEnrollmentById(enrollmentId);
  }

  // Complete lesson
  @Put(':enrollmentId/lessons/:lessonIndex/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async completeLesson(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
  ) {
    return await this.enrollmentsService.completeLesson(
      enrollmentId,
      parseInt(lessonIndex),
    );
  }

  // Submit lesson assessment
  @Post(':enrollmentId/lessons/:lessonIndex/assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async submitLessonAssessment(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
    @Body() submitDto: SubmitLessonAssessmentDto,
  ) {
    return await this.enrollmentsService.submitLessonAssessment(
      enrollmentId,
      parseInt(lessonIndex),
      submitDto,
    );
  }

  // Submit final assessment
  @Post(':enrollmentId/final-assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async submitFinalAssessment(
    @Param('enrollmentId') enrollmentId: string,
    @Body() submitDto: SubmitFinalAssessmentDto,
  ) {
    return await this.enrollmentsService.submitFinalAssessment(
      enrollmentId,
      submitDto,
    );
  }

  // Grade essay assessment (instructor only)
  @Post(':enrollmentId/grade-essay')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async gradeEssayAssessment(
    @Param('enrollmentId') enrollmentId: string,
    @Body() body: { pass: boolean; feedback: string; score?: number },
    @Request() req,
  ) {
    return await this.enrollmentsService.gradeEssayAssessment(
      enrollmentId,
      req.user.id,
      body.pass,
      body.feedback,
      body.score,
    );
  }
}
