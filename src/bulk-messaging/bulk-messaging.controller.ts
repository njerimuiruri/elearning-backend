import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BulkMessagingService } from './bulk-messaging.service';
import {
  SendInstructorReminderDto,
  SendAdminReminderDto,
  SendBulkEmailDto,
  PreviewRecipientsDto,
} from './dto/bulk-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('bulk-messaging')
@UseGuards(JwtAuthGuard)
export class BulkMessagingController {
  constructor(private readonly bulkMessagingService: BulkMessagingService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // INSTRUCTOR ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET /bulk-messaging/instructor/module/:moduleId/students
   * Get enrolled students with optional status filter.
   * Query params: filter (all|assessment_pending|assessment_submitted|assessment_passed|assessment_failed|inactive), inactiveDays
   */
  @Get('instructor/module/:moduleId/students')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getEnrolledStudents(
    @Param('moduleId') moduleId: string,
    @Request() req,
    @Query('filter') filter?: string,
    @Query('inactiveDays') inactiveDays?: string,
  ) {
    const students =
      await this.bulkMessagingService.getEnrolledStudentsWithStatus(
        req.user.id,
        moduleId,
        filter,
        inactiveDays ? parseInt(inactiveDays, 10) : undefined,
      );
    return { success: true, data: students, count: students.length };
  }

  /**
   * POST /bulk-messaging/instructor/send
   * Send bulk reminder to filtered students in a module.
   */
  @Post('instructor/send')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async sendInstructorReminder(
    @Body() dto: SendInstructorReminderDto,
    @Request() req,
  ) {
    const result = await this.bulkMessagingService.sendInstructorBulkMessage(
      req.user.id,
      dto,
    );
    return { success: true, ...result };
  }

  /**
   * GET /bulk-messaging/instructor/history
   * Get instructor's sent reminder history.
   */
  @Get('instructor/history')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async getInstructorHistory(@Request() req) {
    const history =
      await this.bulkMessagingService.getInstructorReminderHistory(req.user.id);
    return { success: true, data: history };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET /bulk-messaging/admin/instructors/grading-status
   * View all instructors with their pending/completed grading status.
   * Query params: moduleId, categoryId
   */
  @Get('admin/instructors/grading-status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getInstructorGradingStatus(
    @Query('moduleId') moduleId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const data = await this.bulkMessagingService.getInstructorGradingStatus(
      moduleId,
      categoryId,
    );
    return { success: true, data };
  }

  /**
   * GET /bulk-messaging/admin/students
   * View all students with optional filters.
   * Query params: moduleId, categoryId, filter, inactiveDays
   */
  @Get('admin/students')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllStudents(
    @Query('moduleId') moduleId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('filter') filter?: string,
    @Query('inactiveDays') inactiveDays?: string,
  ) {
    const data = await this.bulkMessagingService.getAllStudentsWithFilters(
      moduleId,
      categoryId,
      filter,
      inactiveDays ? parseInt(inactiveDays, 10) : undefined,
    );
    return { success: true, data, count: data.length };
  }

  /**
   * POST /bulk-messaging/admin/send
   * Send bulk reminder to students or instructors.
   */
  @Post('admin/send')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendAdminReminder(@Body() dto: SendAdminReminderDto, @Request() req) {
    const result = await this.bulkMessagingService.sendAdminBulkMessage(
      req.user.id,
      dto,
    );
    return { success: true, ...result };
  }

  /**
   * GET /bulk-messaging/admin/history
   * View full history of all sent bulk reminders.
   */
  @Get('admin/history')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAdminHistory(@Query('limit') limit?: string) {
    const history = await this.bulkMessagingService.getAllReminderHistory(
      limit ? parseInt(limit, 10) : 50,
    );
    return { success: true, data: history };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN BULK EMAIL ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /bulk-messaging/admin/bulk-email/preview-recipients
   * Preview who will receive the email based on the selected filter.
   */
  @Post('admin/bulk-email/preview-recipients')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async previewRecipients(@Body() dto: PreviewRecipientsDto) {
    const recipients =
      await this.bulkMessagingService.previewBulkEmailRecipients(dto);
    return { success: true, data: recipients, count: recipients.length };
  }

  /**
   * POST /bulk-messaging/admin/bulk-email/send
   * Compose and send a bulk email campaign (fires in background batches).
   */
  @Post('admin/bulk-email/send')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendBulkEmail(@Body() dto: SendBulkEmailDto, @Request() req: any) {
    const result = await this.bulkMessagingService.sendBulkEmail(
      req.user.id,
      dto,
    );
    return result;
  }

  /**
   * GET /bulk-messaging/admin/bulk-email
   * List all bulk email campaigns (newest first, recipients excluded from list).
   * Query params: limit, offset
   */
  @Get('admin/bulk-email')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getBulkEmailCampaigns(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.bulkMessagingService.getBulkEmailCampaigns(
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    return { success: true, ...result };
  }

  /**
   * GET /bulk-messaging/admin/bulk-email/:id
   * Get a single campaign with full per-recipient delivery status.
   */
  @Get('admin/bulk-email/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getBulkEmailCampaign(@Param('id') id: string) {
    const campaign = await this.bulkMessagingService.getBulkEmailCampaign(id);
    return { success: true, data: campaign };
  }
}
