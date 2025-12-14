import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';
import { CreateStudentDto, BulkCreateStudentsDto } from './dto/student.dto';

@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Dashboard Statistics
  @Get('stats')
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // User Management
  @Get('users')
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
  async activateUser(@Param('id') id: string) {
    return this.adminService.updateUserStatus(id, true);
  }

  @Put('users/:id/deactivate')
  async deactivateUser(@Param('id') id: string) {
    return this.adminService.updateUserStatus(id, false);
  }

  @Post('courses/migrate')
  async migrateCoursesToNewSchema() {
    return this.adminService.migrateCourses();
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
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
  async updateStudent(
    @Param('id') id: string,
    @Body() updateData: any,
  ) {
    return this.adminService.updateStudent(id, updateData);
  }

  @Delete('students/:id')
  async deleteStudent(@Param('id') id: string) {
    return this.adminService.deleteStudent(id);
  }

  // Instructor Management
  @Get('instructors/pending')
  async getPendingInstructors() {
    return this.adminService.getPendingInstructors();
  }

  @Get('instructors/:id')
  async getInstructorDetails(@Param('id') id: string) {
    return this.adminService.getInstructorDetails(id);
  }

  @Put('instructors/:id/approve')
  async approveInstructor(@Param('id') id: string) {
    return this.adminService.approveInstructor(id);
  }

  @Put('instructors/:id/reject')
  async rejectInstructor(
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.adminService.rejectInstructor(id, reason);
  }

  @Get('instructors')
  async getAllInstructors(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getAllInstructors({ status, page, limit });
  }

  // Activity Logs
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
  ) {
    return this.adminService.getAllFellows({ status, page, limit });
  }

  @Get('fellows/at-risk')
  async getFellowsAtRisk() {
    return this.adminService.getFellowsAtRisk();
  }

  @Post('fellows/:id/send-reminder')
  async sendFellowReminder(
    @Param('id') id: string,
    @Body('message') message: string,
  ) {
    return this.adminService.sendFellowReminder(id, message);
  }

  // Analytics
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
  ) {
    return this.adminService.rejectPendingCourse(id, reason);
  }

  @Delete('courses/:id')
  async deleteCourse(@Param('id') id: string) {
    return this.adminService.deleteCourse(id);
  }

  // Reminder System
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

  @Post('reminders/send-bulk')
  async sendRemindersToMultiple(
    @Body() body: { enrollmentIds: string[]; message?: string },
  ) {
    return this.adminService.sendRemindersToMultipleStudents(body.enrollmentIds, body.message);
  }

  @Post('reminders/send-all')
  async sendRemindersToAll(
    @Body() body: { message?: string },
  ) {
    return this.adminService.sendRemindersToAllNotFinished(body.message);
  }
}