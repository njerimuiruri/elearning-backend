import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications
   * Get current user's notifications (latest 30)
   */
  @Get()
  async getMyNotifications(@Request() req, @Query('limit') limit?: string) {
    const notifications = await this.notificationsService.getUserNotifications(
      req.user.id,
      limit ? parseInt(limit, 10) : 30,
    );
    return { success: true, data: notifications };
  }

  /**
   * GET /notifications/unread-count
   * Get unread notification count
   */
  @Get('unread-count')
  async getUnreadCount(@Request() req) {
    const count = await this.notificationsService.getUnreadCount(req.user.id);
    return { success: true, data: { count } };
  }

  /**
   * PUT /notifications/read-all
   * Mark all notifications as read
   */
  @Put('read-all')
  async markAllAsRead(@Request() req) {
    const result = await this.notificationsService.markAllAsRead(req.user.id);
    return {
      success: true,
      message: `${result.modified} notification(s) marked as read`,
    };
  }

  /**
   * PUT /notifications/:id/read
   * Mark a single notification as read
   */
  @Put(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req) {
    const notification = await this.notificationsService.markAsRead(
      id,
      req.user.id,
    );
    return {
      success: true,
      message: 'Notification marked as read',
      data: notification,
    };
  }
}
