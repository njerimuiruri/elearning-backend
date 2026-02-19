import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Discussion } from '../schemas/discussion.schema';
import { Module } from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { User } from '../schemas/user.schema';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../schemas/notification.schema';
import { CreateDiscussionDto, AddReplyDto } from './dto/discussion.dto';

@Injectable()
export class DiscussionsService {
  constructor(
    @InjectModel(Discussion.name)
    private discussionModel: Model<Discussion>,
    @InjectModel(Module.name)
    private moduleModel: Model<Module>,
    @InjectModel(ModuleEnrollment.name)
    private enrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Instructor creates a discussion thread for a module
   */
  async createDiscussion(
    instructorId: string,
    dto: CreateDiscussionDto,
  ): Promise<Discussion> {
    const module = await this.moduleModel
      .findById(dto.moduleId)
      .populate('instructorIds', 'firstName lastName email');

    if (!module) throw new NotFoundException('Module not found');

    // Verify instructor is assigned to this module
    const isAssigned = module.instructorIds?.some(
      (inst: any) => inst._id.toString() === instructorId,
    );
    if (!isAssigned) {
      throw new ForbiddenException(
        'You are not assigned as an instructor for this module',
      );
    }

    const instructor = await this.userModel.findById(instructorId);
    const instructorName = instructor
      ? `${instructor.firstName} ${instructor.lastName}`.trim()
      : 'Instructor';

    const discussion = new this.discussionModel({
      moduleId: new Types.ObjectId(dto.moduleId),
      instructorId: new Types.ObjectId(instructorId),
      createdById: new Types.ObjectId(instructorId),
      createdByRole: 'instructor',
      moduleIndex: dto.lessonIndex ?? 0,
      moduleTitle: dto.lessonTitle || '',
      title: dto.title,
      content: dto.content,
    });

    await discussion.save();

    // Notify all enrolled students
    const enrollments = await this.enrollmentModel
      .find({ moduleId: new Types.ObjectId(dto.moduleId) })
      .populate('studentId', 'firstName lastName email');

    const frontendUrl =
      process.env.FRONTEND_URL || 'http://localhost:3000';
    const discussionLink = `${frontendUrl}/student/modules/${dto.moduleId}/discussions/${discussion._id}`;

    for (const enrollment of enrollments) {
      const student = enrollment.studentId as any;
      if (!student?.email) continue;

      // Dashboard notification
      await this.notificationsService.createNotification(
        student._id.toString(),
        NotificationType.DISCUSSION_POST,
        'New Discussion Posted',
        `${instructorName} posted a new discussion in "${module.title}": ${dto.title}`,
        discussionLink,
        discussion._id.toString(),
      );

      // Email notification
      await this.emailService.sendDiscussionNotificationToStudent(
        student.email,
        `${student.firstName} ${student.lastName}`.trim(),
        module.title,
        dto.lessonTitle || '',
        dto.title,
        discussionLink,
        false,
      ).catch(() => {}); // Non-blocking
    }

    return discussion;
  }

  /**
   * Get all discussions for a module (enrolled students + instructor + admin)
   */
  async getModuleDiscussions(
    moduleId: string,
    userId: string,
    userRole: string,
  ): Promise<Discussion[]> {
    if (userRole !== 'admin') {
      await this.validateModuleAccess(moduleId, userId, userRole);
    }

    return this.discussionModel
      .find({ moduleId: new Types.ObjectId(moduleId) })
      .sort({ isPinned: -1, createdAt: -1 })
      .lean() as any;
  }

  /**
   * Get a single discussion with replies
   */
  async getDiscussion(
    discussionId: string,
    userId: string,
    userRole: string,
  ): Promise<Discussion> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    if (userRole !== 'admin') {
      await this.validateModuleAccess(
        discussion.moduleId?.toString() || '',
        userId,
        userRole,
      );
    }

    // Increment view count
    await this.discussionModel.findByIdAndUpdate(discussionId, {
      $inc: { views: 1 },
    });

    return discussion;
  }

  /**
   * Add a reply to a discussion
   */
  async addReply(
    discussionId: string,
    authorId: string,
    authorRole: 'student' | 'instructor',
    dto: AddReplyDto,
  ): Promise<Discussion> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    const moduleId = discussion.moduleId?.toString();
    if (!moduleId) throw new BadRequestException('Discussion has no module');

    // Validate access
    await this.validateModuleAccess(moduleId, authorId, authorRole);

    const author = await this.userModel.findById(authorId);
    const authorName = author
      ? `${author.firstName} ${author.lastName}`.trim()
      : authorRole === 'instructor' ? 'Instructor' : 'Student';

    const reply = {
      authorId: new Types.ObjectId(authorId),
      authorName,
      content: dto.content,
      likes: 0,
      createdAt: new Date(),
    };

    discussion.replies.push(reply as any);
    await discussion.save();

    const module = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds', 'firstName lastName email');

    const frontendUrl =
      process.env.FRONTEND_URL || 'http://localhost:3000';
    const discussionLink = `${frontendUrl}/student/modules/${moduleId}/discussions/${discussionId}`;

    if (authorRole === 'student') {
      // Notify instructor(s)
      for (const inst of (module?.instructorIds || []) as any[]) {
        if (!inst?.email) continue;

        await this.notificationsService.createNotification(
          inst._id.toString(),
          NotificationType.DISCUSSION_REPLY,
          'New Student Reply in Discussion',
          `${authorName} replied to "${discussion.title}" in "${module?.title}"`,
          `${frontendUrl}/instructor/modules/${moduleId}/discussions/${discussionId}`,
          discussion._id.toString(),
        );

        await this.emailService.sendDiscussionNotificationToInstructor(
          inst.email,
          `${inst.firstName} ${inst.lastName}`.trim(),
          authorName,
          module?.title || '',
          discussion.title,
          `${frontendUrl}/instructor/modules/${moduleId}/discussions/${discussionId}`,
        ).catch(() => {});
      }

      // Notify other enrolled students (dashboard only)
      const enrollments = await this.enrollmentModel
        .find({ moduleId: new Types.ObjectId(moduleId) })
        .populate('studentId', '_id firstName lastName email');

      for (const enrollment of enrollments) {
        const student = enrollment.studentId as any;
        if (!student?._id || student._id.toString() === authorId) continue;

        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.DISCUSSION_REPLY,
          'New Reply in Discussion',
          `${authorName} replied to "${discussion.title}" in "${module?.title}"`,
          discussionLink,
          discussion._id.toString(),
        );
      }
    } else {
      // Instructor replied — notify all enrolled students
      const enrollments = await this.enrollmentModel
        .find({ moduleId: new Types.ObjectId(moduleId) })
        .populate('studentId', '_id firstName lastName email');

      for (const enrollment of enrollments) {
        const student = enrollment.studentId as any;
        if (!student?.email) continue;

        await this.notificationsService.createNotification(
          student._id.toString(),
          NotificationType.DISCUSSION_REPLY,
          'Instructor Replied to Discussion',
          `${authorName} replied to "${discussion.title}" in "${module?.title}"`,
          discussionLink,
          discussion._id.toString(),
        );

        await this.emailService.sendDiscussionNotificationToStudent(
          student.email,
          `${student.firstName} ${student.lastName}`.trim(),
          module?.title || '',
          discussion.moduleTitle || '',
          discussion.title,
          discussionLink,
          true,
        ).catch(() => {});
      }
    }

    return discussion;
  }

  /**
   * Pin or unpin a discussion (instructor only)
   */
  async pinDiscussion(
    discussionId: string,
    instructorId: string,
  ): Promise<Discussion> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    if (discussion.instructorId.toString() !== instructorId) {
      throw new ForbiddenException('Only the creating instructor can pin this discussion');
    }

    discussion.isPinned = !discussion.isPinned;
    discussion.pinnedAt = discussion.isPinned ? new Date() : null;
    return discussion.save();
  }

  /**
   * Get all discussions (admin)
   */
  async getAllDiscussionsAdmin(): Promise<Discussion[]> {
    return this.discussionModel
      .find()
      .populate('moduleId', 'title level')
      .populate('instructorId', 'firstName lastName email')
      .populate('studentId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean() as any;
  }

  /**
   * Delete a discussion (admin or creator)
   */
  async deleteDiscussion(
    discussionId: string,
    userId: string,
    userRole: string,
  ): Promise<{ message: string }> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    if (
      userRole !== 'admin' &&
      discussion.createdById.toString() !== userId
    ) {
      throw new ForbiddenException('Not authorized to delete this discussion');
    }

    await this.discussionModel.findByIdAndDelete(discussionId);
    return { message: 'Discussion deleted successfully' };
  }

  /**
   * Validate that a user has access to a module's discussions
   */
  private async validateModuleAccess(
    moduleId: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    if (!moduleId) throw new BadRequestException('Module ID is required');

    if (userRole === 'instructor') {
      const module = await this.moduleModel.findById(moduleId);
      const isAssigned = module?.instructorIds?.some(
        (id: any) => id.toString() === userId,
      );
      if (!isAssigned) {
        throw new ForbiddenException('You are not assigned to this module');
      }
      return;
    }

    // Student: must be enrolled
    const enrollment = await this.enrollmentModel.findOne({
      moduleId: new Types.ObjectId(moduleId),
      studentId: new Types.ObjectId(userId),
    });

    if (!enrollment) {
      throw new ForbiddenException(
        'You must be enrolled in this module to access discussions',
      );
    }
  }
}
