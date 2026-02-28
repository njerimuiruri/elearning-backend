import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
   * Create a discussion thread.
   * Access control is handled entirely by the service:
   *   - Instructor: must be assigned to the module
   *   - Student: must be enrolled in the module
   *   - Admin: allowed to create/moderate discussions
   * No RolesGuard here — any authenticated user may attempt;
   * the service throws 403 if the user lacks the required access.
   */
  @Post()
  async createDiscussion(@Request() req, @Body() dto: CreateDiscussionDto) {
    const role = req.user.role as 'student' | 'instructor' | 'admin';
    const discussion = await this.discussionsService.createDiscussion(
      req.user.id,
      role,
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
   * Admin views all discussions across the platform for monitoring.
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
   * Get all discussions for a module.
   * Query params:
   *   sort=recent (default) | active
   *   lessonIndex=<number>  — filter to a specific lesson
   * Access: enrolled students, assigned instructors, admin.
   */
  @Get('module/:moduleId')
  async getModuleDiscussions(
    @Param('moduleId') moduleId: string,
    @Query('sort') sort: 'recent' | 'active' = 'recent',
    @Query('lessonIndex') lessonIndex: string | undefined,
    @Request() req,
  ) {
    const discussions = await this.discussionsService.getModuleDiscussions(
      moduleId,
      req.user.id,
      req.user.role,
      sort,
      lessonIndex !== undefined ? parseInt(lessonIndex, 10) : undefined,
    );
    return { success: true, data: discussions };
  }

  /**
   * GET /discussions/:discussionId
   * Get a single discussion thread with all its replies.
   * Access: enrolled students, assigned instructors, admin.
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
   * Add a reply to a thread.
   * Access: enrolled students, assigned instructors.
   */
  @Post(':discussionId/reply')
  async addReply(
    @Param('discussionId') discussionId: string,
    @Body() dto: AddReplyDto,
    @Request() req,
  ) {
    const role = req.user.role as 'student' | 'instructor' | 'admin';
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
   * Pin or unpin a discussion thread (assigned instructor or admin only).
   */
  @Put(':discussionId/pin')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  async pinDiscussion(
    @Param('discussionId') discussionId: string,
    @Request() req,
  ) {
    const discussion = await this.discussionsService.pinDiscussion(
      discussionId,
      req.user.id,
      req.user.role,
    );
    return {
      success: true,
      message: discussion.isPinned ? 'Discussion pinned' : 'Discussion unpinned',
      data: discussion,
    };
  }

  /**
   * PUT /discussions/:discussionId/resolve
   * Mark a discussion as resolved / answered (assigned instructor or admin only).
   */
  @Put(':discussionId/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.INSTRUCTOR, UserRole.ADMIN)
  async resolveDiscussion(
    @Param('discussionId') discussionId: string,
    @Request() req,
  ) {
    const discussion = await this.discussionsService.resolveDiscussion(
      discussionId,
      req.user.id,
      req.user.role,
    );
    return {
      success: true,
      message: discussion.isResolved
        ? 'Discussion marked as resolved'
        : 'Discussion re-opened',
      data: discussion,
    };
  }

  /**
   * DELETE /discussions/:discussionId
   * Delete a discussion.
   * - Admin: can delete any discussion
   * - Instructor: can delete any discussion in their assigned module
   * - Student: can only delete their own discussion
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
