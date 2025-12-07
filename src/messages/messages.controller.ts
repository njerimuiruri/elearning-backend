import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  async sendMessage(
    @CurrentUser() user: any,
    @Body() body: { receiverId: string; content: string; courseId?: string; moduleIndex?: number },
  ) {
    const message = await this.messagesService.sendMessage(
      user._id,
      body.receiverId,
      body.content,
      body.courseId,
      body.moduleIndex,
    );

    return {
      success: true,
      message: 'Message sent successfully',
      data: message,
    };
  }

  @Get('conversations')
  async getConversations(@CurrentUser() user: any) {
    const conversations = await this.messagesService.getConversations(user._id);

    return {
      success: true,
      data: conversations,
    };
  }

  @Get('conversation/:userId')
  async getConversation(
    @CurrentUser() user: any,
    @Param('userId') otherUserId: string,
    @Query('limit') limit?: string,
  ) {
    const messages = await this.messagesService.getConversation(
      user._id,
      otherUserId,
      limit ? parseInt(limit) : 50,
    );

    return {
      success: true,
      data: messages,
    };
  }

  @Put(':messageId/read')
  async markAsRead(@CurrentUser() user: any, @Param('messageId') messageId: string) {
    const message = await this.messagesService.markAsRead(messageId, user._id);

    return {
      success: true,
      message: 'Message marked as read',
      data: message,
    };
  }

  @Put('conversation/:userId/read')
  async markConversationAsRead(@CurrentUser() user: any, @Param('userId') otherUserId: string) {
    await this.messagesService.markConversationAsRead(user._id, otherUserId);

    return {
      success: true,
      message: 'Conversation marked as read',
    };
  }

  @Delete(':messageId')
  async deleteMessage(@CurrentUser() user: any, @Param('messageId') messageId: string) {
    await this.messagesService.deleteMessage(messageId, user._id);

    return {
      success: true,
      message: 'Message deleted successfully',
    };
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: any) {
    const result = await this.messagesService.getUnreadCount(user._id);

    return {
      success: true,
      data: result,
    };
  }
}
