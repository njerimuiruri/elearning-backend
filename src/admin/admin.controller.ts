import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminService } from './admin.service';
import { ReminderService } from '../services/reminder.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';
import { CreateStudentDto, BulkCreateStudentsDto } from './dto/student.dto';
import { CreateInstructorDto } from './dto/instructor.dto';
import {
  CreateFellowDto,
  BulkCreateFellowsDto,
  BulkSendEmailDto,
} from './dto/fellow.dto';
import { CreateModuleDto } from '../modules/dto/create-module.dto';
import { UpdateModuleDto } from '../modules/dto/update-module.dto';

@Controller('api/admin')
@ApiTags('Admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('jwt-auth')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly reminderService: ReminderService,
  ) {}

  @Put('courses/:id/set-price')
  async setCoursePrice(
    @Param('id') id: string,
    @Body('price') price: number,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.setCoursePrice(id, price, admin._id);
  }

  // Dashboard Statistics
  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard stats including user counts, course stats, etc.',
  })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // User Management
  @Get('users')
  @ApiOperation({ summary: 'Get all users with filters (Admin only)' })
  @ApiQuery({ name: 'role', required: false, description: 'Filter by role' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: 'number',
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    description: 'Results per page',
  })
  @ApiResponse({ status: 200, description: 'List of users' })
  async getAllUsers(
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getAllUsers({ role, status, page, limit });
  }

  @Get('users/:id')
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Put('users/:id/activate')
  async activateUser(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.updateUserStatus(id, true, admin._id?.toString());
  }

  @Put('users/:id/deactivate')
  async deactivateUser(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.updateUserStatus(id, false, admin._id?.toString());
  }

  @Post('courses/migrate')
  async migrateCoursesToNewSchema() {
    return this.adminService.migrateCourses();
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.deleteUser(id, admin._id?.toString());
  }

  // Student Management
  @Get('students')
  async getAllStudents(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllStudents({ page, limit, search });
  }

  @Get('students/:id')
  async getStudentById(@Param('id') id: string) {
    return this.adminService.getStudentById(id);
  }

  @Post('students')
  async createStudent(@Body() createStudentDto: CreateStudentDto) {
    return this.adminService.createStudent(createStudentDto);
  }

  @Post('students/bulk')
  @UseInterceptors(FileInterceptor('file'))
  async bulkCreateStudents(
    @UploadedFile() file: Express.Multer.File,
    @Body() bulkDto: BulkCreateStudentsDto,
  ) {
    return this.adminService.bulkCreateStudents(file, bulkDto);
  }

  @Put('students/:id')
  async updateStudent(@Param('id') id: string, @Body() updateData: any) {
    return this.adminService.updateStudent(id, updateData);
  }

  @Delete('students/:id')
  async deleteStudent(@Param('id') id: string) {
    return this.adminService.deleteStudent(id);
  }

  // Instructor Management
  @Post('instructors')
  @ApiOperation({ summary: 'Create a new instructor manually (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Instructor created successfully. Registration email sent.',
  })
  async createInstructor(@Body() createInstructorDto: CreateInstructorDto) {
    return this.adminService.createInstructor(createInstructorDto);
  }

  @Get('instructors/pending')
  async getPendingInstructors() {
    return this.adminService.getPendingInstructors();
  }

  @Get('instructors/:id')
  async getInstructorDetails(@Param('id') id: string) {
    return this.adminService.getInstructorDetails(id);
  }

  @Put('instructors/:id/approve')
  async approveInstructor(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.approveInstructor(id, admin._id?.toString());
  }

  @Put('instructors/:id/reject')
  async rejectInstructor(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.rejectInstructor(
      id,
      reason,
      admin._id?.toString(),
    );
  }

  @Get('instructors')
  async getAllInstructors(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getAllInstructors({ status, page, limit });
  }

  @Put('fellows/:id/categories')
  @ApiOperation({ summary: 'Assign categories to a fellow' })
  async assignFellowCategories(
    @Param('id') id: string,
    @Body('categories') categories: string[],
    @CurrentUser() admin: any,
  ) {
    return this.adminService.assignFellowCategories(id, categories, admin._id);
  }

  // Activity Logs
  @Delete('instructors/:id')
  @ApiOperation({ summary: 'Delete instructor and their associated courses' })
  @ApiParam({ name: 'id', description: 'Instructor user ID' })
  @ApiResponse({
    status: 200,
    description: 'Instructor and their courses deleted successfully',
  })
  async deleteInstructor(@Param('id') id: string) {
    return this.adminService.deleteInstructor(id);
  }
  @Get('activity')
  async getRecentActivity(
    @Query('limit') limit?: number,
    @Query('type') type?: string,
  ) {
    return this.adminService.getRecentActivity({ limit, type });
  }

  // Fellows Management
  @Get('fellows')
  async getAllFellows(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllFellows({ status, page, limit, search });
  }

  @Get('fellows/at-risk')
  async getFellowsAtRisk() {
    return this.adminService.getFellowsAtRisk();
  }

  // ─── Progress routes must appear BEFORE fellows/:id ──────────────────────────

  @Get('fellows/progress/stats')
  @ApiOperation({ summary: 'Aggregate overview stats for the progress dashboard' })
  async getFellowProgressStats() {
    return this.adminService.getFellowProgressStats();
  }

  @Get('fellows/progress')
  @ApiOperation({ summary: 'List all fellows with module completion progress' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'module', required: false, description: 'Module ObjectId' })
  @ApiQuery({ name: 'search', required: false })
  async getFellowsProgress(
    @Query('status') status?: string,
    @Query('module') module?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getFellowsProgress({
      status,
      module,
      search,
    });
  }

  @Get('fellows/learning-analytics')
  @ApiOperation({ summary: 'Learning activity analytics: hour-of-day and day-of-week patterns' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'days', required: false, description: 'Look-back window in days (default 90)' })
  async getLearningAnalytics(
    @Query('categoryId') categoryId?: string,
    @Query('days') days?: string,
  ) {
    return this.adminService.getLearningAnalytics({
      categoryId,
      days: days ? parseInt(days, 10) : 90,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────

  @Get('fellows/:id')
  async getFellowById(@Param('id') id: string) {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new NotFoundException('Fellow not found');
    }
    return this.adminService.getFellowById(id);
  }

  @Post('fellows')
  async createFellow(@Body() dto: CreateFellowDto) {
    return this.adminService.createFellow(dto);
  }

  @Post('fellows/bulk')
  async bulkCreateFellows(@Body() dto: BulkCreateFellowsDto) {
    return this.adminService.bulkCreateFellows(
      dto.fellows,
      dto.sendEmails ?? false,
    );
  }

  @Post('fellows/bulk-email')
  async sendBulkEmail(@Body() dto: BulkSendEmailDto) {
    return this.adminService.sendBulkEmailToFellows(
      dto.fellowIds,
      dto.subject,
      dto.message,
      dto.cc,
      dto.bcc,
    );
  }

  @Post('fellows/send-invitations')
  async sendFellowInvitations(@Body('fellowIds') fellowIds: string[]) {
    return this.adminService.sendFellowInvitations(fellowIds);
  }

  @Put('fellows/:id')
  async updateFellow(@Param('id') id: string, @Body() updateData: any) {
    return this.adminService.updateFellow(id, updateData);
  }

  @Delete('fellows/:id')
  async deleteFellow(@Param('id') id: string) {
    return this.adminService.deleteFellow(id);
  }

  @Post('fellows/:id/reset-password')
  async resetFellowPassword(@Param('id') id: string) {
    return this.adminService.resetFellowPassword(id);
  }

  @Post('fellows/:id/send-reminder')
  async sendFellowReminder(
    @Param('id') id: string,
    @Body('message') message: string,
  ) {
    return this.adminService.sendFellowReminder(id, message);
  }

  @Get('fellows/:id/progress')
  @ApiOperation({ summary: 'Get full module-by-module progress for a single fellow' })
  async getFellowProgressDetail(@Param('id') id: string) {
    return this.adminService.getFellowProgressDetail(id);
  }

  @Put('fellows/:id/progress-action')
  @ApiOperation({ summary: 'Admin action: allow_proceed | suspend | unsuspend | deactivate | mark_completed' })
  async updateFellowProgressAction(
    @Param('id') id: string,
    @Body('action') action: 'allow_proceed' | 'suspend' | 'unsuspend' | 'deactivate' | 'mark_completed',
    @Body('note') note: string,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.updateFellowProgressAction(
      admin._id?.toString(),
      id,
      action,
      note,
    );
  }

  // Analytics
  @Get('analytics/overview')
  @ApiOperation({ summary: 'Get comprehensive platform analytics' })
  async getAnalyticsOverview() {
    return this.adminService.getAnalyticsOverview();
  }

  @Get('analytics/student-progress')
  @ApiOperation({ summary: 'Get detailed student progress analytics' })
  @ApiQuery({ name: 'limit', required: false, type: 'number' })
  @ApiQuery({
    name: 'status',
    required: false,
    type: 'string',
    description: 'Filter by in-progress or completed',
  })
  async getStudentProgressAnalytics(
    @Query('limit') limit?: number,
    @Query('status') status?: 'in-progress' | 'completed' | 'all',
  ) {
    return this.adminService.getStudentProgressAnalytics(limit, status);
  }

  @Get('analytics/instructor-activity')
  @ApiOperation({ summary: 'Get instructor activity analytics' })
  async getInstructorActivityAnalytics() {
    return this.adminService.getInstructorActivityAnalytics();
  }

  @Get('analytics/course-completion')
  @ApiOperation({ summary: 'Get course completion rate analytics' })
  async getCourseCompletionAnalytics() {
    return this.adminService.getCourseCompletionAnalytics();
  }

  @Get('analytics/users')
  async getUserAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.adminService.getUserAnalytics({ startDate, endDate });
  }

  @Get('analytics/revenue')
  async getRevenueAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.adminService.getRevenueAnalytics({ startDate, endDate });
  }

  // Course Management
  @Get('courses/pending')
  async getPendingCourses(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getPendingCourses({ page, limit });
  }

  @Get('courses')
  async getAllCourses(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getAllCourses({ status, page, limit });
  }

  @Get('courses/:id')
  async getAdminCourse(@Param('id') id: string) {
    return this.adminService.getCourseById(id);
  }

  @Put('courses/:id/approve')
  async approveCourse(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('feedback') feedback?: string,
  ) {
    return this.adminService.approvePendingCourse(id, user._id);
  }

  @Put('courses/:id/reject')
  async rejectCourse(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.rejectPendingCourse(
      id,
      reason,
      admin._id?.toString(),
    );
  }

  @Delete('courses/:id')
  async deleteCourse(@Param('id') id: string) {
    return this.adminService.deleteCourse(id);
  }

  // Reminder System
  @Get('reminders/students-needing-reminders')
  @ApiOperation({
    summary: 'Get students who need course completion reminders',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'number' })
  async getStudentsNeedingReminders(@Query('limit') limit?: number) {
    return this.reminderService.getStudentsNeedingReminders(limit);
  }

  @Get('reminders/stats')
  @ApiOperation({ summary: 'Get reminder statistics' })
  async getReminderStats() {
    return this.reminderService.getReminderStats();
  }

  @Get('reminders/settings')
  @ApiOperation({ summary: 'Get reminder system settings' })
  async getReminderSettings() {
    return this.reminderService.getReminderSettings();
  }

  @Put('reminders/settings')
  @ApiOperation({ summary: 'Update reminder system settings' })
  async updateReminderSettings(
    @Body()
    settings: {
      autoRemindersEnabled?: boolean;
      reminderDelayDays?: number;
    },
  ) {
    return this.reminderService.updateReminderSettings(settings);
  }

  @Post('reminders/send/:enrollmentId')
  @ApiOperation({ summary: 'Send manual reminder to a specific student' })
  @ApiParam({ name: 'enrollmentId', description: 'Enrollment ID' })
  async sendManualReminder(@Param('enrollmentId') enrollmentId: string) {
    return this.reminderService.sendCourseReminder(enrollmentId, 'manual');
  }

  @Post('reminders/send-bulk')
  @ApiOperation({ summary: 'Send reminders to multiple students' })
  async sendBulkReminders(@Body() body: { enrollmentIds: string[] }) {
    return this.reminderService.sendBulkReminders(body.enrollmentIds);
  }

  @Post('reminders/trigger-automatic')
  @ApiOperation({
    summary: 'Manually trigger automatic reminder check (for testing)',
  })
  async triggerAutomaticReminders() {
    await this.reminderService.handleAutomaticReminders();
    return { success: true, message: 'Automatic reminder check triggered' };
  }

  @Get('reminders/students-not-finished')
  async getStudentsNotFinished(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getStudentsNotFinished({ page, limit });
  }

  @Post('reminders/send-to-student/:enrollmentId')
  async sendReminderToStudent(
    @Param('enrollmentId') enrollmentId: string,
    @Body('message') message?: string,
  ) {
    return this.adminService.sendReminderToStudent(enrollmentId, message);
  }

  @Post('reminders/send-bulk-old')
  async sendRemindersToMultiple(
    @Body() body: { enrollmentIds: string[]; message?: string },
  ) {
    return this.adminService.sendRemindersToMultipleStudents(
      body.enrollmentIds,
      body.message,
    );
  }

  @Post('reminders/send-all')
  async sendRemindersToAll(@Body() body: { message?: string }) {
    return this.adminService.sendRemindersToAllNotFinished(body.message);
  }

  // Course Format Management
  @Post('course-format/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload course format document (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Course format uploaded successfully',
  })
  async uploadCourseFormat(
    @UploadedFile() file: Express.Multer.File,
    @Body('description') description?: string,
    @Body('version') version?: string,
    @CurrentUser() admin?: any,
  ) {
    return this.adminService.uploadCourseFormat(
      file,
      description,
      version,
      admin?._id?.toString(),
    );
  }

  @Get('course-format')
  @ApiOperation({ summary: 'Get current course format document (Admin only)' })
  @ApiResponse({ status: 200, description: 'Course format document details' })
  async getCourseFormat() {
    return this.adminService.getCourseFormat();
  }

  @Delete('course-format/:id')
  @ApiOperation({ summary: 'Delete course format document (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Course format deleted successfully',
  })
  async deleteCourseFormat(@Param('id') id: string) {
    return this.adminService.deleteCourseFormat(id);
  }

  // ===================== MODULE MANAGEMENT =====================

  @Post('modules')
  @ApiOperation({
    summary: 'Admin creates a module on behalf of an instructor',
  })
  async createModuleAsAdmin(
    @Body() createModuleDto: CreateModuleDto,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.createModuleAsAdmin(
      admin._id?.toString(),
      createModuleDto,
    );
  }

  @Get('modules')
  @ApiOperation({ summary: 'Get all modules with filters (Admin only)' })
  async getAllModules(
    @Query('status') status?: string,
    @Query('level') level?: string,
    @Query('category') category?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getAllModules({
      status,
      level,
      category,
      page,
      limit,
    });
  }

  @Get('modules/pending')
  @ApiOperation({ summary: 'Get pending modules awaiting approval' })
  async getPendingModules(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getPendingModules({ page, limit });
  }

  @Get('modules/stats')
  @ApiOperation({ summary: 'Get module dashboard statistics' })
  async getModuleDashboardStats() {
    return this.adminService.getModuleDashboardStats();
  }

  @Get('modules/:id')
  @ApiOperation({ summary: 'Get module details with enrollment stats' })
  async getModuleById(@Param('id') id: string) {
    return this.adminService.getModuleById(id);
  }

  @Put('modules/:id/approve')
  @ApiOperation({ summary: 'Approve a submitted module' })
  async approveModule(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.approveModule(id, admin._id?.toString());
  }

  @Put('modules/:id/publish')
  @ApiOperation({ summary: 'Publish an approved module' })
  async publishModule(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.publishModule(id, admin._id?.toString());
  }

  @Put('modules/:id/reject')
  @ApiOperation({ summary: 'Reject a submitted module' })
  async rejectModule(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.rejectModule(id, reason, admin._id?.toString());
  }

  @Put('modules/:id')
  @ApiOperation({
    summary:
      'Update any module — admin can edit regardless of status or ownership',
  })
  async updateModuleAsAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateModuleDto,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.updateModuleAsAdmin(
      id,
      admin._id?.toString(),
      dto,
    );
  }

  @Put('modules/:id/finalize')
  @ApiOperation({ summary: 'Finalize module content — unlocks Final Assessment for students' })
  async finalizeModuleContent(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.finalizeContentAsAdmin(id, admin._id?.toString());
  }

  @Post('modules/:id/lessons')
  @ApiOperation({
    summary:
      'Add a lesson to any module — admin can add lessons regardless of status or ownership',
  })
  async addModuleLessonAsAdmin(
    @Param('id') id: string,
    @Body() lessonData: any,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.addModuleLessonAsAdmin(
      id,
      admin._id?.toString(),
      lessonData,
    );
  }

  @Delete('modules/:id/lessons/:lessonIndex')
  @ApiOperation({
    summary:
      'Delete a lesson from any module — admin can remove lessons regardless of status or ownership',
  })
  async deleteModuleLessonAsAdmin(
    @Param('id') id: string,
    @Param('lessonIndex') lessonIndex: string,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.deleteModuleLessonAsAdmin(
      id,
      parseInt(lessonIndex),
      admin._id?.toString(),
    );
  }

  @Delete('modules/:id')
  @ApiOperation({
    summary:
      'Delete (deactivate) a module — admin can remove any module regardless of status',
  })
  async deleteModule(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.deleteModuleAsAdmin(id, admin._id?.toString());
  }

  @Put('modules/:id/approve-assessment')
  @ApiOperation({ summary: 'Approve a pending assessment update' })
  async approveAssessment(@Param('id') id: string, @CurrentUser() admin: any) {
    return this.adminService.approveAssessment(id, admin._id?.toString());
  }

  @Put('modules/:id/reject-assessment')
  @ApiOperation({ summary: 'Reject a pending assessment update' })
  async rejectAssessment(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() admin: any,
  ) {
    return this.adminService.rejectAssessment(
      id,
      reason,
      admin._id?.toString(),
    );
  }
}
