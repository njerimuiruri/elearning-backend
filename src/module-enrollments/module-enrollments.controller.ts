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
import { ModuleEnrollmentsService } from './module-enrollments.service';
import {
  SubmitFinalAssessmentDto,
  SubmitLessonAssessmentDto,
} from './dto/submit-assessment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('module-enrollments')
export class ModuleEnrollmentsController {
  constructor(private readonly enrollmentsService: ModuleEnrollmentsService) {}
  private getUserId(req: any): string {
    const userId = req?.user?.id ?? req?.user?._id?.toString?.() ?? req?.user?._id;
    if (!userId) {
      throw new Error('Authenticated user id is missing on request');
    }
    return String(userId);
  }

  // Enroll in module
  @Post('modules/:moduleId/enroll')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async enrollInModule(@Param('moduleId') moduleId: string, @Request() req) {
    return await this.enrollmentsService.enrollInModule(
      this.getUserId(req),
      moduleId,
    );
  }

  // Get student's enrollments
  @Get('my-enrollments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getMyEnrollments(@Request() req) {
    return await this.enrollmentsService.getStudentEnrollments(
      this.getUserId(req),
    );
  }

  // Get enrollment by student and module
  @Get('modules/:moduleId/my-enrollment')
  @UseGuards(JwtAuthGuard)
  async getMyEnrollmentForModule(
    @Param('moduleId') moduleId: string,
    @Request() req,
  ) {
    return await this.enrollmentsService.getEnrollmentByStudentAndModule(
      this.getUserId(req),
      moduleId,
    );
  }

  // ---------------------------------------------------------------------------
  // Instructor: list all final-assessment submissions for their modules
  // GET /module-enrollments/instructor/submissions?moduleId=&submissionType=&status=
  // ---------------------------------------------------------------------------
  @Get('instructor/submissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorSubmissions(
    @Request() req,
    @Query('moduleId') moduleId?: string,
    @Query('submissionType') submissionType?: 'essay' | 'mcq' | 'all',
    @Query('status') status?: 'pending' | 'passed' | 'failed' | 'all',
  ) {
    const data = await this.enrollmentsService.getInstructorSubmissions(
      this.getUserId(req),
      { moduleId, submissionType, status },
    );
    return { success: true, data };
  }

  // ---------------------------------------------------------------------------
  // Instructor: list modules they teach (for filter dropdown)
  // GET /module-enrollments/instructor/modules
  // ---------------------------------------------------------------------------
  @Get('instructor/modules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorModules(@Request() req) {
    const data = await this.enrollmentsService.getInstructorModulesList(
      this.getUserId(req),
    );
    return { success: true, data };
  }

  // ---------------------------------------------------------------------------
  // Instructor: list all students enrolled in their modules (searchable)
  // GET /module-enrollments/instructor/students?search=&limit=
  // ---------------------------------------------------------------------------
  @Get('instructor/students')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorStudents(
    @Request() req,
    @Query('search') search?: string,
  ) {
    const data = await this.enrollmentsService.getInstructorEnrolledStudents(
      this.getUserId(req),
      search,
    );
    return { success: true, data };
  }

  // Get enrollment details
  @Get(':enrollmentId')
  @UseGuards(JwtAuthGuard)
  async getEnrollmentById(@Param('enrollmentId') enrollmentId: string) {
    return await this.enrollmentsService.getEnrollmentById(enrollmentId);
  }

  // Track slide progress (engagement: time spent + scroll)
  @Put(':enrollmentId/lessons/:lessonIndex/slides/:slideIndex/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async trackSlideProgress(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
    @Param('slideIndex') slideIndex: string,
    @Body() body: { timeSpent: number; scrolledToBottom: boolean },
  ) {
    return await this.enrollmentsService.trackSlideProgress(
      enrollmentId,
      parseInt(lessonIndex),
      parseInt(slideIndex),
      body.timeSpent,
      body.scrolledToBottom,
    );
  }

  // ── NEW: Get fresh, server-derived progress (single source of truth) ──────
  // Returns lessonStates[], nextLessonIndex, completedLessons, progress%, etc.
  // Frontend should call this on mount and after every mutation.
  @Get(':enrollmentId/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getEnrollmentProgress(
    @Param('enrollmentId') enrollmentId: string,
    @Request() req,
  ) {
    return await this.enrollmentsService.getEnrollmentProgress(
      enrollmentId,
      this.getUserId(req),
    );
  }

  // ── NEW: Idempotent lesson completion (replaces old completeLesson) ────────
  // Safe to call multiple times for the same lesson — second call is a no-op.
  // Returns fresh progress state (same shape as GET /progress).
  @Put(':enrollmentId/lessons/:lessonIndex/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async completeLesson(
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonIndex') lessonIndex: string,
    @Request() req,
  ) {
    return await this.enrollmentsService.markLessonCompleted(
      enrollmentId,
      parseInt(lessonIndex),
      this.getUserId(req),
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

  // ── Admin: delete a specific enrollment (for testing / admin resets) ─────────
  @Delete('admin/reset/:enrollmentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminDeleteEnrollment(@Param('enrollmentId') enrollmentId: string) {
    return await this.enrollmentsService.adminDeleteEnrollment(enrollmentId);
  }

  // ── Admin: delete ALL enrollments for a student (fresh-start reset) ──────────
  @Delete('admin/reset-student/:studentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminResetStudent(@Param('studentId') studentId: string) {
    return await this.enrollmentsService.adminResetStudentEnrollments(studentId);
  }

  // ── Admin: unblock stuck students (clear cooldown + reset attempts) ─────────
  @Post('admin/reset-assessment/:enrollmentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminResetAssessment(@Param('enrollmentId') enrollmentId: string) {
    return await this.enrollmentsService.adminResetAssessment(enrollmentId);
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
      this.getUserId(req),
      body.pass,
      body.feedback,
      body.score,
    );
  }
}
