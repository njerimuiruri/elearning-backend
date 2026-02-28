import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
    relatedId?: string,
  ): Promise<NotificationDocument> {
    const notification = new this.notificationModel({
      userId: new Types.ObjectId(userId),
      type,
      title,
      message,
      link: link || null,
      relatedId: relatedId ? new Types.ObjectId(relatedId) : null,
    });
    return notification.save();
  }

  /**
   * Create a reminder notification (from instructor or admin).
   * Supports optional moduleId and categoryId for student-side filtering.
   */
  async createReminderNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
    moduleId?: string,
    categoryId?: string,
  ): Promise<NotificationDocument> {
    const notification = new this.notificationModel({
      userId: new Types.ObjectId(userId),
      type,
      title,
      message,
      link: link || null,
      moduleId: moduleId ? new Types.ObjectId(moduleId) : null,
      categoryId: categoryId ? new Types.ObjectId(categoryId) : null,
    });
    return notification.save();
  }

  /**
   * Get only reminder notifications (INSTRUCTOR_REMINDER / ADMIN_REMINDER)
   * for a user, with optional module/category filter.
   */
  async getStudentReminders(
    userId: string,
    moduleId?: string,
    categoryId?: string,
  ): Promise<NotificationDocument[]> {
    const query: any = {
      userId: new Types.ObjectId(userId),
      type: {
        $in: [NotificationType.INSTRUCTOR_REMINDER, NotificationType.ADMIN_REMINDER],
      },
    };

    if (moduleId) query.moduleId = new Types.ObjectId(moduleId);
    if (categoryId) query.categoryId = new Types.ObjectId(categoryId);

    return this.notificationModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean() as any;
  }

  async getUserNotifications(
    userId: string,
    limit = 30,
  ): Promise<NotificationDocument[]> {
    return this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean() as any;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationDocument | null> {
    return this.notificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      { isRead: true },
      { new: true },
    );
  }

  async markAllAsRead(userId: string): Promise<{ modified: number }> {
    const result = await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { isRead: true },
    );
    return { modified: result.modifiedCount };
  }
}
