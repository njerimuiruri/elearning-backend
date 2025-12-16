import { Controller, Get, Post, Put, Body, Param, UseGuards, Query, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CourseService } from './courses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';
import { Enrollment } from '../schemas/enrollment.schema';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';

@Controller('api/courses')
@ApiTags('Courses')
export class CourseController {
  constructor(
    private readonly courseService: CourseService,
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
  ) {}

  // Instructor Routes - must come before generic :id route
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Create a new course (Instructor only)' })
  @ApiResponse({ status: 201, description: 'Course created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - only instructors can create courses' })
  async createCourse(
    @Body() createCourseDto: CreateCourseDto,
    @CurrentUser() user: any,
  ) {
    // Instructors can create courses regardless of approval status
    // The course will be in DRAFT status and can be submitted for approval
    return this.courseService.createCourse(user._id, createCourseDto);
  }

  @Get('instructor/my-courses')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Get all courses created by instructor' })
  @ApiResponse({ status: 200, description: 'List of instructor courses' })
  async getInstructorCourses(@CurrentUser() user: any) {
    return this.courseService.getInstructorCourses(user._id);
  }

  // ====== SPECIFIC ROUTES (must come BEFORE generic /:id routes) ======

  // Instructor - Submit for approval
  @Post('/:id/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Submit course for admin approval (Instructor only)' })
  @ApiParam({ name: 'id', description: 'Course ID' })
  @ApiResponse({ status: 200, description: 'Course submitted for approval' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  async submitCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    console.log('========================================');
    console.log('SUBMIT COURSE REQUEST');
    console.log('========================================');
    console.log('Course ID:', id);
    console.log('User ID:', user._id);
    console.log('User Email:', user.email);
    console.log('User Role:', user.role);
    
    const course = await this.courseService.getCourseById(id);
    
    console.log('Course found:', !!course);
    if (course) {
      console.log('Course Title:', course.title);
      console.log('Course Status:', course.status);
      console.log('Course InstructorIds:', course.instructorIds);
    }
    
    if (!course) {
      console.log('❌ Course not found');
      throw new NotFoundException('Course not found');
    }
    // If course has no instructors OR current user is not among them, assign
    if (!course.instructorIds || !Array.isArray(course.instructorIds) || !course.instructorIds.map(i => i.toString()).includes(user._id.toString())) {
      console.log('⚠️ Assigning course to current instructor');
      await this.courseService.assignInstructorToCourse(id, user._id);
    }
    
    console.log('✅ Authorization passed, submitting course');
    return this.courseService.submitCourse(id, user._id);
  }

  // Admin Routes - Course Approval
  @Put('/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Approve a course (Admin only)' })
  @ApiParam({ name: 'id', description: 'Course ID' })
  @ApiResponse({ status: 200, description: 'Course approved' })
  @ApiResponse({ status: 403, description: 'Only admins can approve' })
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

  // Assessment Routes - Instructor
  @Post('/:id/final-assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async createFinalAssessment(
    @Param('id') id: string,
    @Body() assessmentData: any,
    @CurrentUser() user: any,
  ) {
    // Verify ownership
    const course = await this.courseService.getCourseById(id);
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    if (!course.instructorIds || !course.instructorIds.map(i => i.toString()).includes(user._id.toString())) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.addFinalAssessment(id, assessmentData);
  }

  @Get('/:id/final-assessment')
  async getFinalAssessment(@Param('id') id: string) {
    return this.courseService.getFinalAssessment(id);
  }

  @Put('/:id/final-assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async updateFinalAssessment(
    @Param('id') id: string,
    @Body() assessmentData: any,
    @CurrentUser() user: any,
  ) {
    // Verify ownership
    const course = await this.courseService.getCourseById(id);
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    if (!course.instructorIds || !course.instructorIds.map(i => i.toString()).includes(user._id.toString())) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.updateFinalAssessment(id, assessmentData);
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

  @Get('/:id/enrollment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getEnrollmentForCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.getEnrollmentForCourse(user._id, id);
  }

  // Student Routes
  @Get('student/my-enrollments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentEnrollments(@CurrentUser() user: any) {
    return this.courseService.getStudentEnrollments(user._id);
  }

  @Get('student/certificates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentCertificates(@CurrentUser() user: any) {
    return this.courseService.getStudentCertificates(user._id);
  }

  // Progress Routes
  @Post('enrollment/:enrollmentId/progress')
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

  // Track lesson-level progress and last visited lesson for resume
  @Post('enrollment/:enrollmentId/lesson-progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async updateLessonProgress(
    @Param('enrollmentId') enrollmentId: string,
    @Body('moduleIndex') moduleIndex: number,
    @Body('lessonIndex') lessonIndex: number,
    @Body('completed') completed: boolean,
  ) {
    return this.courseService.updateLessonProgress(enrollmentId, moduleIndex, lessonIndex, completed);
  }

  @Get('enrollment/:enrollmentId/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getProgress(@Param('enrollmentId') enrollmentId: string) {
    return this.courseService.getEnrollmentProgress(enrollmentId);
  }

  // Discussion Routes
  @Post('/:id/discussions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT, UserRole.INSTRUCTOR)
  async createDiscussion(
    @Param('id') id: string,
    @Body() discussionData: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.createDiscussion({
      ...discussionData,
      courseId: id,
      studentId: user.role === UserRole.STUDENT ? user._id : undefined,
      instructorId: discussionData.instructorId || undefined,
      createdById: user._id,
      createdByRole: user.role === UserRole.INSTRUCTOR ? 'instructor' : 'student',
    });
  }

  @Get('/:id/discussions')
  @UseGuards(JwtAuthGuard)
  async getDiscussions(
    @Param('id') id: string,
    @Query('moduleIndex') moduleIndex?: string,
    @CurrentUser() user?: any,
  ) {
    return this.courseService.getCoursesDiscussions(
      id,
      moduleIndex ? parseInt(moduleIndex, 10) : undefined,
      user?._id,
    );
  }

  @Post('discussions/:discussionId/reply')
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
      authorRole: user.role === UserRole.INSTRUCTOR ? 'instructor' : 'student',
      createdAt: new Date(),
    });
  }

  @Post('discussions/:discussionId/read')
  @UseGuards(JwtAuthGuard)
  async markDiscussionRead(
    @Param('discussionId') discussionId: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.markDiscussionRead(discussionId, user?._id);
  }

  // Dashboard Routes
  @Get('dashboard/instructor')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorDashboard(@CurrentUser() user: any) {
    return this.courseService.getInstructorDashboard(user._id);
  }

  @Get('dashboard/student')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentDashboard(@CurrentUser() user: any) {
    return this.courseService.getStudentDashboard(user._id);
  }

  // Module Assessment Routes
  @Post('enrollment/:enrollmentId/module/:moduleIndex/assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async submitModuleAssessment(
    @Param('enrollmentId') enrollmentId: string,
    @Param('moduleIndex') moduleIndex: string,
    @Body('answers') answers: any[],
  ) {
    return this.courseService.submitModuleAssessment(enrollmentId, parseInt(moduleIndex), answers);
  }

  // Final Assessment Routes (with retry logic)
  @Post('enrollment/:enrollmentId/final-assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async submitFinalAssessment(
    @Param('enrollmentId') enrollmentId: string,
    @Body('answers') answers: any[],
  ) {
    return this.courseService.submitFinalAssessment(enrollmentId, answers);
  }

  // Restart Course
  @Post('enrollment/:enrollmentId/restart')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async restartCourse(@Param('enrollmentId') enrollmentId: string) {
    return this.courseService.restartCourse(enrollmentId);
  }

  // ====== INSTRUCTOR SPECIFIC ROUTES (before generic /:id) ======

  @Get(':id/submissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getCourseSubmissions(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.getCourseSubmissions(id, user._id);
  }

  @Get(':id/debug-submissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async debugSubmissions(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    console.log('\n🔍 DEBUG SUBMISSIONS ENDPOINT');
    console.log('Course ID:', id);
    console.log('Instructor ID:', user._id.toString());
    
    try {
      // 1. Verify course exists
      const course = await this.courseService.getCourseById(id);
      if (!course) {
        return { error: 'Course not found' };
      }
      console.log('✅ Course found:', course?.title);
      console.log('   Course instructorIds:', course?.instructorIds?.map((id: any) => id?.toString?.() ?? String(id)));
      
      // 2. Check all enrollments for this course (regardless of attempts)
      const allEnrollments = await this.enrollmentModel.find({
        courseId: course._id,
      }).select('_id studentId finalAssessmentAttempts finalAssessmentScore courseId');
      
      console.log(`✅ Total enrollments for course: ${allEnrollments.length}`);
      allEnrollments.forEach((e: any, idx: number) => {
        console.log(`   ${idx + 1}. Enrollment: ${e._id}`);
        console.log(`      - StudentId: ${e.studentId}`);
        console.log(`      - CourseId: ${e.courseId}`);
        console.log(`      - Attempts: ${e.finalAssessmentAttempts}`);
        console.log(`      - Score: ${e.finalAssessmentScore}`);
      });
      
      // 3. Check enrollments with attempts > 0
      const submissionEnrollments = await this.enrollmentModel.find({
        courseId: course._id,
        finalAssessmentAttempts: { $gt: 0 },
      }).select('_id studentId finalAssessmentAttempts finalAssessmentScore courseId');
      
      console.log(`✅ Enrollments with attempts > 0: ${submissionEnrollments.length}`);
      submissionEnrollments.forEach((e: any, idx: number) => {
        console.log(`   ${idx + 1}. Enrollment: ${e._id}`);
        console.log(`      - Attempts: ${e.finalAssessmentAttempts}`);
        console.log(`      - Score: ${e.finalAssessmentScore}`);
      });
      
      return {
        courseId: id,
        instructorId: user._id.toString(),
        courseTitle: course?.title,
        courseInstructor: Array.isArray(course?.instructorIds) && course.instructorIds.length > 0 ? course.instructorIds[0]?.toString?.() ?? String(course.instructorIds[0]) : undefined,
        totalEnrollments: allEnrollments.length,
        enrollmentsWithSubmissions: submissionEnrollments.length,
        allEnrollments: allEnrollments.map((e: any) => ({
          _id: e._id.toString(),
          studentId: e.studentId.toString(),
          finalAssessmentAttempts: e.finalAssessmentAttempts,
          finalAssessmentScore: e.finalAssessmentScore,
          courseId: e.courseId.toString(),
        })),
        enrollmentsWithAttempts: submissionEnrollments.map((e: any) => ({
          _id: e._id.toString(),
          studentId: e.studentId.toString(),
          finalAssessmentAttempts: e.finalAssessmentAttempts,
          finalAssessmentScore: e.finalAssessmentScore,
        })),
      };
    } catch (error) {
      console.error('❌ Debug error:', error.message);
      return { error: error.message };
    }
  }

  @Post('assessment/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async submitAssessmentReview(
    @Body() reviewData: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.submitAssessmentReview(reviewData, user._id);
  }

  @Get('instructor/course/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    console.log('📌 GET /instructor/course/:id route hit');
    console.log('Course ID:', id);
    console.log('User ID:', user._id);
    
    const course = await this.courseService.getCourseById(id);
    
    if (!course) {
      console.log('❌ Course not found in database');
      throw new NotFoundException('Course not found');
    }
    
    console.log('✅ Course found:', course.title);
    console.log('Course instructorIds:', course.instructorIds);
    console.log('User ID:', user._id);
    
    if (!course.instructorIds || !Array.isArray(course.instructorIds) || course.instructorIds.length === 0) {
      console.log('⚠️ Course has no instructorIds, assigning to current user');
      course.instructorIds = [user._id];
      // Don't await, just attempt to update
      this.courseService.updateCourse(id, { instructorIds: [user._id] }).catch(err => 
        console.log('Could not update instructorIds:', err.message)
      );
    }

    const instructorIds = Array.isArray(course.instructorIds) ? course.instructorIds.map(i => i.toString()) : [];
    const userIdString = user._id.toString ? user._id.toString() : String(user._id);
    console.log('Comparing IDs:');
    console.log('Course instructorIds:', instructorIds);
    console.log('User ID (stringified):', userIdString);
    if (!instructorIds.includes(userIdString)) {
      console.log('❌ Unauthorized: course instructor mismatch');
      throw new UnauthorizedException('You are not authorized to view this course');
    }
    
    console.log('✅ Returning course');
    return course;
  }

  // ====== GENERIC ROUTES (must come LAST) ======

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

  // Generic course routes (must come after specific routes)
  @Get('/:id')
  async getCourse(@Param('id') id: string) {
    return this.courseService.getCourseById(id);
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
    if (!course.instructorIds || !course.instructorIds.map(i => i.toString()).includes(user._id.toString())) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.updateCourse(id, updateCourseDto);
  }
}
