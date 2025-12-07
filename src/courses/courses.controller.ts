import { Controller, Get, Post, Put, Body, Param, UseGuards, Query, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CourseService } from './courses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';

@Controller('api/courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  // Public - Get all published courses
  @Get()
  async getAllCourses(
    @Query('category') category?: string,
    @Query('level') level?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.courseService.getAllPublishedCourses({
      category,
      level,
      page,
      limit,
    });
  }

  @Get('/:id')
  async getCourse(@Param('id') id: string) {
    return this.courseService.getCourseById(id);
  }

  // Instructor Routes
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async createCourse(
    @Body() createCourseDto: CreateCourseDto,
    @CurrentUser() user: any,
  ) {
    return this.courseService.createCourse(user._id, createCourseDto);
  }

  @Get('instructor/my-courses')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorCourses(@CurrentUser() user: any) {
    return this.courseService.getInstructorCourses(user._id);
  }

  @Put('/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async updateCourse(
    @Param('id') id: string,
    @Body() updateCourseDto: UpdateCourseDto,
    @CurrentUser() user: any,
  ) {
    // Verify ownership
    const course = await this.courseService.getCourseById(id);
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    if (course.instructorId.toString() !== user._id.toString()) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.updateCourse(id, updateCourseDto);
  }

  @Post('/:id/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async submitCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    const course = await this.courseService.getCourseById(id);
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    if (course.instructorId.toString() !== user._id.toString()) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.submitCourse(id);
  }

  // Admin Routes - Course Approval
  @Put('/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async approveCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('feedback') feedback?: string,
  ) {
    return this.courseService.approveCourse(id, user._id, feedback);
  }

  @Put('/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async rejectCourse(
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.courseService.rejectCourse(id, reason);
  }

  @Put('/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async publishCourse(@Param('id') id: string) {
    return this.courseService.publishCourse(id);
  }

  // Enrollment Routes
  @Post('/:id/enroll')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async enrollCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.enrollStudent(user._id, id);
  }

  @Get('/student/my-enrollments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentEnrollments(@CurrentUser() user: any) {
    return this.courseService.getStudentEnrollments(user._id);
  }

  // Progress Routes
  @Post('/enrollment/:enrollmentId/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async updateProgress(
    @Param('enrollmentId') enrollmentId: string,
    @Body('moduleIndex') moduleIndex: number,
    @Body('score') score: number,
    @Body('answers') answers: any[],
  ) {
    return this.courseService.updateProgress(enrollmentId, moduleIndex, score, answers);
  }

  @Get('/enrollment/:enrollmentId/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getProgress(@Param('enrollmentId') enrollmentId: string) {
    return this.courseService.getEnrollmentProgress(enrollmentId);
  }

  // Certificate Routes
  @Get('/student/certificates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentCertificates(@CurrentUser() user: any) {
    return this.courseService.getStudentCertificates(user._id);
  }

  // Discussion Routes
  @Post('/:id/discussions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async createDiscussion(
    @Param('id') id: string,
    @Body() discussionData: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.createDiscussion({
      ...discussionData,
      courseId: id,
      studentId: user._id,
    });
  }

  @Get('/:id/discussions')
  @UseGuards(JwtAuthGuard)
  async getDiscussions(@Param('id') id: string) {
    return this.courseService.getCoursesDiscussions(id);
  }

  @Post('/discussions/:discussionId/reply')
  @UseGuards(JwtAuthGuard)
  async addReply(
    @Param('discussionId') discussionId: string,
    @Body() reply: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.addDiscussionReply(discussionId, {
      ...reply,
      authorId: user._id,
      authorName: `${user.firstName} ${user.lastName}`,
      createdAt: new Date(),
    });
  }

  // Dashboard Routes
  @Get('/dashboard/instructor')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorDashboard(@CurrentUser() user: any) {
    return this.courseService.getInstructorDashboard(user._id);
  }

  @Get('/dashboard/student')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentDashboard(@CurrentUser() user: any) {
    return this.courseService.getStudentDashboard(user._id);
  }
}
