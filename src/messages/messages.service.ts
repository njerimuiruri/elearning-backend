import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from '../schemas/message.schema';
import { User } from '../schemas/user.schema';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<Message>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async sendMessage(senderId: string, receiverId: string, content: string, courseId?: string, moduleIndex?: number) {
    const message = new this.messageModel({
      senderId: new Types.ObjectId(senderId),
      receiverId: new Types.ObjectId(receiverId),
      content,
      courseId: courseId ? new Types.ObjectId(courseId) : undefined,
      moduleIndex,
      isRead: false,
    });

    await message.save();

    return message.populate([
      { path: 'senderId', select: 'firstName lastName email profilePhotoUrl' },
      { path: 'receiverId', select: 'firstName lastName email profilePhotoUrl' },
    ]);
  }

  async getConversation(userId: string, otherUserId: string, limit: number = 50) {
    const messages = await this.messageModel
      .find({
        $or: [
          { senderId: new Types.ObjectId(userId), receiverId: new Types.ObjectId(otherUserId) },
          { senderId: new Types.ObjectId(otherUserId), receiverId: new Types.ObjectId(userId) },
        ],
        isDeleted: false,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'firstName lastName email profilePhotoUrl')
      .populate('receiverId', 'firstName lastName email profilePhotoUrl')
      .populate('courseId', 'title')
      .exec();

    return messages.reverse();
  }

  async getConversations(userId: string) {
    const messages = await this.messageModel.aggregate([
      {
        $match: {
          $or: [
            { senderId: new Types.ObjectId(userId) },
            { receiverId: new Types.ObjectId(userId) },
          ],
          isDeleted: false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$senderId', new Types.ObjectId(userId)] },
              '$receiverId',
              '$senderId',
            ],
          },
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiverId', new Types.ObjectId(userId)] },
                    { $eq: ['$isRead', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $sort: { 'lastMessage.createdAt': -1 },
      },
    ]);

    const conversations = await Promise.all(
      messages.map(async (conv) => {
        const otherUser = await this.userModel
          .findById(conv._id)
          .select('firstName lastName email profilePhotoUrl role')
          .lean();

        return {
          user: otherUser,
          lastMessage: conv.lastMessage,
          unreadCount: conv.unreadCount,
        };
      }),
    );

    return conversations;
  }

  async markAsRead(messageId: string, userId: string) {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.receiverId.toString() !== userId) {
      throw new NotFoundException('Unauthorized');
    }

    message.isRead = true;
    message.readAt = new Date();
    await message.save();

    return message;
  }

  async markConversationAsRead(userId: string, otherUserId: string) {
    await this.messageModel.updateMany(
      {
        senderId: new Types.ObjectId(otherUserId),
        receiverId: new Types.ObjectId(userId),
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    return { success: true };
  }

  async deleteMessage(messageId: string, userId: string) {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId.toString() !== userId) {
      throw new NotFoundException('Unauthorized');
    }

    message.isDeleted = true;
    await message.save();

    return { success: true };
  }

  async getUnreadCount(userId: string) {
    const count = await this.messageModel.countDocuments({
      receiverId: new Types.ObjectId(userId),
      isRead: false,
      isDeleted: false,
    });

    return { count };
  }
}
