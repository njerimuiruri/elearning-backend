import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CourseService } from './courses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CategoryAccessGuard } from '../categories/guards/category-access.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';
import { Enrollment } from '../schemas/enrollment.schema';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';

// Helper to normalize populated or raw instructor id entries
function normalizeInstructorIds(ids: any): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((i: any) => {
    if (!i) return '';
    if (typeof i === 'string') return i;
    if (i._id) return String(i._id);
    if (i.id) return String(i.id);
    try {
      return String(i);
    } catch (err) {
      return '';
    }
  });
}

@Controller('api/courses')
@ApiTags('Courses')
export class CourseController {
  // === Draft/Review/Publish Workflow ===
  @Put('/:courseId/modules/:moduleIndex/lessons/:lessonIndex/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Save lesson as draft (Co-Instructor)' })
  async saveLessonDraft(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Param('lessonIndex') lessonIndex: number,
    @Body() lessonData: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.saveLessonDraft(courseId, moduleIndex, lessonIndex, lessonData, user._id);
  }

  @Put('/:courseId/modules/:moduleIndex/lessons/:lessonIndex/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Submit lesson for review (Co-Instructor)' })
  async submitLessonForReview(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Param('lessonIndex') lessonIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.submitLessonForReview(courseId, moduleIndex, lessonIndex, user._id);
  }

  @Put('/:courseId/modules/:moduleIndex/lessons/:lessonIndex/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Approve and publish lesson (Lead Instructor/Admin)' })
  async approveLesson(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Param('lessonIndex') lessonIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.approveLesson(courseId, moduleIndex, lessonIndex, user._id);
  }

  @Put('/:courseId/modules/:moduleIndex/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Save module as draft (Co-Instructor)' })
  async saveModuleDraft(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Body() moduleData: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.saveModuleDraft(courseId, moduleIndex, moduleData, user._id);
  }

  @Put('/:courseId/modules/:moduleIndex/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Submit module for review (Co-Instructor)' })
  async submitModuleForReview(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.submitModuleForReview(courseId, moduleIndex, user._id);
  }

  @Put('/:courseId/modules/:moduleIndex/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Approve and publish module (Lead Instructor/Admin)' })
  async approveModule(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.approveModule(courseId, moduleIndex, user._id);
  }

  // Module Instructor Management
  @Post('/:courseId/modules/:moduleIndex/instructors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Assign or update a module instructor (Lead only)' })
  async assignModuleInstructor(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Body() instructor: any,
    @CurrentUser() user: any,
  ) {
    return this.courseService.assignModuleInstructor(courseId, moduleIndex, instructor, user._id);
  }

  @Delete('/:courseId/modules/:moduleIndex/instructors/:instructorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Remove a module instructor (Lead only)' })
  async removeModuleInstructor(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Param('instructorId') instructorId: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.removeModuleInstructor(courseId, moduleIndex, instructorId, user._id);
  }

  @Get('/:courseId/modules/:moduleIndex/instructors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Get all instructors for a module' })
  async getModuleInstructors(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
  ) {
    return this.courseService.getModuleInstructors(courseId, moduleIndex);
  }
    // Admin - Set course price
    @Put('/:id/set-price')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth('jwt-auth')
    @ApiOperation({ summary: 'Set course price (Admin only)' })
    @ApiParam({ name: 'id', description: 'Course ID' })
    @ApiResponse({ status: 200, description: 'Price set successfully' })
    async setCoursePrice(
      @Param('id') id: string,
      @Body('price') price: number,
      @CurrentUser() user: any,
    ) {
      return this.courseService.setCoursePrice(id, price, user._id);
    }
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
    if (!course.instructorIds || !normalizeInstructorIds(course.instructorIds).includes(user._id.toString())) {
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
    if (!course.instructorIds || !normalizeInstructorIds(course.instructorIds).includes(user._id.toString())) {
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
    if (!course.instructorIds || !normalizeInstructorIds(course.instructorIds).includes(user._id.toString())) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.updateFinalAssessment(id, assessmentData);
  }

  // Enrollment Routes
  @Post('/:id/enroll')
  @UseGuards(JwtAuthGuard, RolesGuard, CategoryAccessGuard)
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

  @Get('enrollment/:enrollmentId/assessment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getAssessmentForEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.getAssessmentForEnrollment(enrollmentId, user._id);
  }

  @Get('/:id/resume-destination')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getResumeDestination(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.getResumeDestination(user._id, id);
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

  @Get('student/achievements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getStudentAchievements(@CurrentUser() user: any) {
    return this.courseService.getStudentAchievements(user._id);
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
    @Query('sortBy') sortBy?: 'recent' | 'popular' | 'unanswered' | 'mostReplies',
    @Query('filterByStatus') filterByStatus?: 'open' | 'resolved' | 'closed' | 'all',
    @CurrentUser() user?: any,
  ) {
    return this.courseService.getCoursesDiscussions(
      id,
      moduleIndex ? parseInt(moduleIndex, 10) : undefined,
      user?._id,
      { sortBy, filterByStatus },
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

  @Post('discussions/:discussionId/pin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async togglePinDiscussion(
    @Param('discussionId') discussionId: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.togglePinDiscussion(discussionId, user._id);
  }

  @Post('discussions/:discussionId/like')
  @UseGuards(JwtAuthGuard)
  async likeDiscussion(
    @Param('discussionId') discussionId: string,
    @CurrentUser() user: any,
  ) {
    return this.courseService.likeDiscussion(discussionId, user._id);
  }

  @Post('discussions/:discussionId/view')
  @UseGuards(JwtAuthGuard)
  async incrementViews(
    @Param('discussionId') discussionId: string,
  ) {
    return this.courseService.incrementDiscussionViews(discussionId);
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
    return this.courseService.restartCourse(enrollmentId, 'manual_restart', false);
  }

  // Soft Reset Course (only reset attempts, keep progress)
  @Post('enrollment/:enrollmentId/soft-reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async softResetCourse(@Param('enrollmentId') enrollmentId: string) {
    return this.courseService.softResetCourse(enrollmentId);
  }

  // Get Attempt History
  @Get('enrollment/:enrollmentId/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT, UserRole.INSTRUCTOR, UserRole.ADMIN)
  async getAttemptHistory(@Param('enrollmentId') enrollmentId: string) {
    const enrollment = await this.courseService.getEnrollmentById(enrollmentId);
    if (!enrollment) {
      throw new Error('Enrollment not found');
    }
    return {
      attemptHistory: enrollment.attemptHistory || [],
      currentAttemptNumber: enrollment.currentAttemptNumber || 1,
    };
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

    const instructorIds = normalizeInstructorIds(course.instructorIds);
    const userIdString = user._id && user._id.toString ? user._id.toString() : String(user._id);
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


  // Public: Get all published courses with filters
  @Get()
  @ApiOperation({ summary: 'Get all published courses (public)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'category', required: false, description: 'Filter by category' })
  @ApiQuery({ name: 'level', required: false, description: 'Filter by level' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  async getAllCourses(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('level') level?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // Only allow published courses to be fetched publicly
    const result = await this.courseService.getAllPublishedCourses({
      category,
      level,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return result;
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
    if (!course.instructorIds || !normalizeInstructorIds(course.instructorIds).includes(user._id.toString())) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.courseService.updateCourse(id, updateCourseDto);
  }

  // Lock a module for editing
  @Post(':courseId/modules/:moduleIndex/lock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async lockModule(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.lockModule(courseId, moduleIndex, user._id);
  }

  // Unlock a module after editing
  @Post(':courseId/modules/:moduleIndex/unlock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async unlockModule(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.unlockModule(courseId, moduleIndex, user._id);
  }

  // Lock a lesson for editing
  @Post(':courseId/modules/:moduleIndex/lessons/:lessonIndex/lock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async lockLesson(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Param('lessonIndex') lessonIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.lockLesson(courseId, moduleIndex, lessonIndex, user._id);
  }

  // Unlock a lesson after editing
  @Post(':courseId/modules/:moduleIndex/lessons/:lessonIndex/unlock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async unlockLesson(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: number,
    @Param('lessonIndex') lessonIndex: number,
    @CurrentUser() user: any,
  ) {
    return this.courseService.unlockLesson(courseId, moduleIndex, lessonIndex, user._id);
  }

  // Admin: Add instructor to course
  @Post(':id/instructors/:instructorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Add instructor to course (Admin only)' })
  @ApiParam({ name: 'id', description: 'Course ID' })
  @ApiParam({ name: 'instructorId', description: 'Instructor User ID' })
  async addInstructorToCourse(
    @Param('id') id: string,
    @Param('instructorId') instructorId: string,
  ) {
    return this.courseService.assignInstructorToCourse(id, instructorId);
  }

  // Admin: Remove instructor from course
  @Delete(':id/instructors/:instructorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Remove instructor from course (Admin only)' })
  @ApiParam({ name: 'id', description: 'Course ID' })
  @ApiParam({ name: 'instructorId', description: 'Instructor User ID' })
  async removeInstructorFromCourse(
    @Param('id') id: string,
    @Param('instructorId') instructorId: string,
  ) {
    return this.courseService.removeInstructorFromCourse(id, instructorId);
  }
}
