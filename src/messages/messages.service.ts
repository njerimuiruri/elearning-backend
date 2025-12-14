import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from '../schemas/message.schema';
import { User } from '../schemas/user.schema';
import { EmailService } from '../common/services/email.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<Message>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  private toObjectId(id: string, fieldName: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return new Types.ObjectId(id);
  }

  async sendMessage(senderId: string, receiverId: string, content: string, courseId?: string, moduleIndex?: number, attachments?: string[]) {
    const message = new this.messageModel({
      senderId: this.toObjectId(senderId, 'senderId'),
      receiverId: this.toObjectId(receiverId, 'receiverId'),
      content,
      courseId: courseId ? this.toObjectId(courseId, 'courseId') : undefined,
      moduleIndex,
      attachments: attachments || [],
      messageType: attachments && attachments.length > 0 ? 'file' : 'text',
      isRead: false,
    });

    await message.save();

    // Notify receiver via email (best-effort)
    const [sender, receiver] = await Promise.all([
      this.userModel.findById(senderId).lean(),
      this.userModel.findById(receiverId).lean(),
    ]);

    this.sendEmailNotification(sender, receiver, content).catch((err) => {
      console.warn('Failed to send message notification email:', err?.message || err);
    });

    return message.populate([
      { path: 'senderId', select: 'firstName lastName email profilePhotoUrl' },
      { path: 'receiverId', select: 'firstName lastName email profilePhotoUrl' },
    ]);
  }

  async getConversation(userId: string, otherUserId: string, limit: number = 50) {
    const userObjectId = this.toObjectId(userId, 'userId');
    const otherUserObjectId = this.toObjectId(otherUserId, 'otherUserId');

    const messages = await this.messageModel
      .find({
        $or: [
          { senderId: userObjectId, receiverId: otherUserObjectId },
          { senderId: otherUserObjectId, receiverId: userObjectId },
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
    const userObjectId = this.toObjectId(userId, 'userId');

    const messages = await this.messageModel.aggregate([
      {
        $match: {
          $or: [
            { senderId: userObjectId },
            { receiverId: userObjectId },
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
              { $eq: ['$senderId', userObjectId] },
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
                    { $eq: ['$receiverId', userObjectId] },
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
    const userObjectId = this.toObjectId(userId, 'userId');
    const otherUserObjectId = this.toObjectId(otherUserId, 'otherUserId');

    await this.messageModel.updateMany(
      {
        senderId: otherUserObjectId,
        receiverId: userObjectId,
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
    const userObjectId = this.toObjectId(userId, 'userId');

    const count = await this.messageModel.countDocuments({
      receiverId: userObjectId,
      isRead: false,
      isDeleted: false,
    });

    return { count };
  }

  private async sendEmailNotification(sender: any, receiver: any, content: string) {
    if (!receiver?.email || !sender) return;

    const senderName = `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || 'Someone';
    const receiverName = `${receiver.firstName || ''} ${receiver.lastName || ''}`.trim() || 'Hello';
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const inboxPath = receiver.role === 'instructor' ? '/instructor/messages' : '/student/messages';
    const inboxUrl = `${frontendUrl}${inboxPath}`;
    const subject = `New message from ${senderName}`;
    const preview = (content || '').slice(0, 240);

    const html = `
      <h3>${receiverName}, you have a new message</h3>
      <p><strong>From:</strong> ${senderName}</p>
      <p><strong>Message:</strong></p>
      <blockquote style="border-left:4px solid #16a34a;padding-left:12px;color:#444;">${preview}</blockquote>
      <p><a href="${inboxUrl}" style="display:inline-block;margin-top:12px;padding:10px 18px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">Open inbox</a></p>
    `;

    const text = `${receiverName}, you have a new message from ${senderName}:

${preview}

Open inbox: ${inboxUrl}`;

    await this.emailService.sendMessageNotification(receiver.email, subject, html, text);
  }

  async getAllConversationsForAdmin() {
    // Get all unique conversation pairs
    const conversations = await this.messageModel.aggregate([
      {
        $match: { isDeleted: false },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: {
            user1: { $min: ['$senderId', '$receiverId'] },
            user2: { $max: ['$senderId', '$receiverId'] },
          },
          lastMessage: { $first: '$$ROOT' },
          totalMessages: { $sum: 1 },
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ['$isRead', false] }, 1, 0],
            },
          },
        },
      },
      {
        $sort: { 'lastMessage.createdAt': -1 },
      },
      {
        $limit: 100,
      },
    ]);

    // Populate user details
    const populatedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const [user1, user2] = await Promise.all([
          this.userModel.findById(conv._id.user1).select('firstName lastName email role profilePhotoUrl').lean(),
          this.userModel.findById(conv._id.user2).select('firstName lastName email role profilePhotoUrl').lean(),
        ]);

        return {
          users: [user1, user2],
          lastMessage: conv.lastMessage,
          totalMessages: conv.totalMessages,
          unreadCount: conv.unreadCount,
        };
      }),
    );

    return populatedConversations;
  }
}
