import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { DiscussionsService } from './discussions.service';
import { CreateDiscussionDto, AddReplyDto } from './dto/discussion.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('discussions')
@UseGuards(JwtAuthGuard)
export class DiscussionsController {
  constructor(private readonly discussionsService: DiscussionsService) {}

  /**
   * POST /discussions
   * Instructor creates a discussion thread for a module
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async createDiscussion(@Request() req, @Body() dto: CreateDiscussionDto) {
    const discussion = await this.discussionsService.createDiscussion(
      req.user.id,
      dto,
    );
    return {
      success: true,
      message: 'Discussion created successfully',
      data: discussion,
    };
  }

  /**
   * GET /discussions/admin/all
   * Admin views all discussions across the platform
   */
  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllDiscussionsAdmin() {
    const discussions = await this.discussionsService.getAllDiscussionsAdmin();
    return { success: true, data: discussions };
  }

  /**
   * GET /discussions/module/:moduleId
   * Get all discussions for a module (enrolled students + instructors + admin)
   */
  @Get('module/:moduleId')
  async getModuleDiscussions(
    @Param('moduleId') moduleId: string,
    @Request() req,
  ) {
    const discussions = await this.discussionsService.getModuleDiscussions(
      moduleId,
      req.user.id,
      req.user.role,
    );
    return { success: true, data: discussions };
  }

  /**
   * GET /discussions/:discussionId
   * Get a single discussion with its replies
   */
  @Get(':discussionId')
  async getDiscussion(
    @Param('discussionId') discussionId: string,
    @Request() req,
  ) {
    const discussion = await this.discussionsService.getDiscussion(
      discussionId,
      req.user.id,
      req.user.role,
    );
    return { success: true, data: discussion };
  }

  /**
   * POST /discussions/:discussionId/reply
   * Add a reply (enrolled student or assigned instructor)
   */
  @Post(':discussionId/reply')
  async addReply(
    @Param('discussionId') discussionId: string,
    @Body() dto: AddReplyDto,
    @Request() req,
  ) {
    const role = req.user.role as 'student' | 'instructor';
    const discussion = await this.discussionsService.addReply(
      discussionId,
      req.user.id,
      role,
      dto,
    );
    return {
      success: true,
      message: 'Reply added successfully',
      data: discussion,
    };
  }

  /**
   * PUT /discussions/:discussionId/pin
   * Pin or unpin a discussion (instructor only)
   */
  @Put(':discussionId/pin')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  async pinDiscussion(
    @Param('discussionId') discussionId: string,
    @Request() req,
  ) {
    const discussion = await this.discussionsService.pinDiscussion(
      discussionId,
      req.user.id,
    );
    return {
      success: true,
      message: discussion.isPinned
        ? 'Discussion pinned'
        : 'Discussion unpinned',
      data: discussion,
    };
  }

  /**
   * DELETE /discussions/:discussionId
   * Delete a discussion (admin or creator)
   */
  @Delete(':discussionId')
  async deleteDiscussion(
    @Param('discussionId') discussionId: string,
    @Request() req,
  ) {
    const result = await this.discussionsService.deleteDiscussion(
      discussionId,
      req.user.id,
      req.user.role,
    );
    return { success: true, ...result };
  }
}
