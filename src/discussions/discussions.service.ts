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

  // ---------------------------------------------------------------------------
  // Create a discussion thread (instructor, enrolled student, or admin)
  // ---------------------------------------------------------------------------
  async createDiscussion(
    userId: string,
    userRole: 'student' | 'instructor' | 'admin',
    dto: CreateDiscussionDto,
  ): Promise<Discussion> {
    const module = await this.moduleModel
      .findById(dto.moduleId)
      .populate('instructorIds', 'firstName lastName email');

    if (!module) throw new NotFoundException('Module not found');

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (userRole === 'admin') {
      // Admin can post without assignment restrictions
      const admin = await this.userModel.findById(userId);
      const adminName = admin
        ? `${admin.firstName} ${admin.lastName}`.trim()
        : 'Admin';

      const discussion = await new this.discussionModel({
        moduleId: new Types.ObjectId(dto.moduleId),
        createdById: new Types.ObjectId(userId),
        createdByRole: 'admin',
        moduleIndex: dto.lessonIndex ?? 0,
        moduleTitle: dto.lessonTitle || '',
        title: dto.title,
        content: dto.content,
      }).save();

      // Notify all enrolled students
      const enrollments = await this.enrollmentModel
        .find({ moduleId: new Types.ObjectId(dto.moduleId) })
        .populate('studentId', 'firstName lastName email');

      const discussionLink = `${frontendUrl}/student/modules/${dto.moduleId}/discussions/${discussion._id}`;

      await Promise.allSettled(
        enrollments.map(async (enrollment) => {
          const student = enrollment.studentId as any;
          if (!student?.email) return;

          await this.notificationsService.createNotification(
            student._id.toString(),
            NotificationType.DISCUSSION_POST,
            'New Discussion Posted',
            `${adminName} posted a new discussion in "${module.title}": ${dto.title}`,
            discussionLink,
            discussion._id.toString(),
          );

          await this.emailService
            .sendDiscussionNotificationToStudent(
              student.email,
              `${student.firstName} ${student.lastName}`.trim(),
              module.title,
              dto.lessonTitle || '',
              dto.title,
              discussionLink,
              false,
            )
            .catch(() => {});
        }),
      );

      return discussion;
    } else if (userRole === 'instructor') {
      // Instructor must be assigned to the module
      const isAssigned = (module.instructorIds as any[]).some(
        (inst: any) => inst._id.toString() === userId,
      );
      if (!isAssigned) {
        throw new ForbiddenException(
          'You are not assigned as an instructor for this module',
        );
      }

      const instructor = await this.userModel.findById(userId);
      const instructorName = instructor
        ? `${instructor.firstName} ${instructor.lastName}`.trim()
        : 'Instructor';

      const discussion = await new this.discussionModel({
        moduleId: new Types.ObjectId(dto.moduleId),
        instructorId: new Types.ObjectId(userId),
        createdById: new Types.ObjectId(userId),
        createdByRole: 'instructor',
        moduleIndex: dto.lessonIndex ?? 0,
        moduleTitle: dto.lessonTitle || '',
        title: dto.title,
        content: dto.content,
      }).save();

      // Notify all enrolled students (email + dashboard)
      const enrollments = await this.enrollmentModel
        .find({ moduleId: new Types.ObjectId(dto.moduleId) })
        .populate('studentId', 'firstName lastName email');

      const discussionLink = `${frontendUrl}/student/modules/${dto.moduleId}/discussions/${discussion._id}`;

      await Promise.allSettled(
        enrollments.map(async (enrollment) => {
          const student = enrollment.studentId as any;
          if (!student?.email) return;

          await this.notificationsService.createNotification(
            student._id.toString(),
            NotificationType.DISCUSSION_POST,
            'New Discussion Posted',
            `${instructorName} posted a new discussion in "${module.title}": ${dto.title}`,
            discussionLink,
            discussion._id.toString(),
          );

          await this.emailService
            .sendDiscussionNotificationToStudent(
              student.email,
              `${student.firstName} ${student.lastName}`.trim(),
              module.title,
              dto.lessonTitle || '',
              dto.title,
              discussionLink,
              false,
            )
            .catch(() => {});
        }),
      );

      return discussion;
    } else {
      // Student must be enrolled
      const enrollment = await this.enrollmentModel.findOne({
        moduleId: new Types.ObjectId(dto.moduleId),
        studentId: new Types.ObjectId(userId),
      });
      if (!enrollment) {
        throw new ForbiddenException(
          'You must be enrolled in this module to post a discussion',
        );
      }

      const student = await this.userModel.findById(userId);
      const studentName = student
        ? `${student.firstName} ${student.lastName}`.trim()
        : 'Student';

      const discussion = await new this.discussionModel({
        moduleId: new Types.ObjectId(dto.moduleId),
        studentId: new Types.ObjectId(userId),
        createdById: new Types.ObjectId(userId),
        createdByRole: 'student',
        moduleIndex: dto.lessonIndex ?? 0,
        moduleTitle: dto.lessonTitle || '',
        title: dto.title,
        content: dto.content,
      }).save();

      // Notify all module instructors (email + dashboard)
      const instructorLink = `${frontendUrl}/instructor/modules/${dto.moduleId}/discussions/${discussion._id}`;

      await Promise.allSettled(
        (module.instructorIds as any[]).map(async (inst: any) => {
          if (!inst?.email) return;

          await this.notificationsService.createNotification(
            inst._id.toString(),
            NotificationType.DISCUSSION_POST,
            'New Student Discussion Posted',
            `${studentName} posted a new discussion in "${module.title}": ${dto.title}`,
            instructorLink,
            discussion._id.toString(),
          );

          await this.emailService
            .sendDiscussionNotificationToInstructor(
              inst.email,
              `${inst.firstName} ${inst.lastName}`.trim(),
              studentName,
              module.title,
              dto.title,
              instructorLink,
            )
            .catch(() => {});
        }),
      );

      return discussion;
    }
  }

  // ---------------------------------------------------------------------------
  // Get all discussions for a module
  // sort: 'recent' (default) = newest first | 'active' = most recently updated
  // ---------------------------------------------------------------------------
  async getModuleDiscussions(
    moduleId: string,
    userId: string,
    userRole: string,
    sort: 'recent' | 'active' = 'recent',
    lessonIndex?: number,
  ): Promise<Discussion[]> {
    if (userRole !== 'admin') {
      await this.validateModuleAccess(moduleId, userId, userRole);
    }

    const sortField = sort === 'active' ? 'updatedAt' : 'createdAt';
    const query: Record<string, any> = {
      moduleId: new Types.ObjectId(moduleId),
    };
    if (lessonIndex !== undefined) {
      query.moduleIndex = lessonIndex;
    }

    return this.discussionModel
      .find(query)
      .sort({ isPinned: -1, [sortField]: -1 })
      .lean() as any;
  }

  // ---------------------------------------------------------------------------
  // Get a single discussion with its replies
  // ---------------------------------------------------------------------------
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

    await this.discussionModel.findByIdAndUpdate(discussionId, {
      $inc: { views: 1 },
    });

    return discussion;
  }

  // ---------------------------------------------------------------------------
  // Add a reply (enrolled student OR assigned instructor)
  // ---------------------------------------------------------------------------
  async addReply(
    discussionId: string,
    authorId: string,
    authorRole: 'student' | 'instructor' | 'admin',
    dto: AddReplyDto,
  ): Promise<Discussion> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    const moduleId = discussion.moduleId?.toString();
    if (!moduleId) throw new BadRequestException('Discussion has no module');

    if (authorRole !== 'admin') {
      await this.validateModuleAccess(moduleId, authorId, authorRole);
    }

    const author = await this.userModel.findById(authorId);
    const authorName = author
      ? `${author.firstName} ${author.lastName}`.trim()
      : authorRole === 'instructor'
        ? 'Instructor'
        : authorRole === 'admin'
          ? 'Admin'
          : 'Student';

    discussion.replies.push({
      authorId: new Types.ObjectId(authorId),
      authorName,
      authorRole,
      content: dto.content,
      likes: 0,
      createdAt: new Date(),
    } as any);

    await discussion.save();

    const module = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds', 'firstName lastName email');

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const studentDiscussionLink = `${frontendUrl}/student/modules/${moduleId}/discussions/${discussionId}`;
    const instructorDiscussionLink = `${frontendUrl}/instructor/modules/${moduleId}/discussions/${discussionId}`;

    if (authorRole === 'student') {
      // 1. Notify all module instructors (email + dashboard)
      await Promise.allSettled(
        ((module?.instructorIds || []) as any[]).map(async (inst: any) => {
          if (!inst?.email) return;

          await this.notificationsService.createNotification(
            inst._id.toString(),
            NotificationType.DISCUSSION_REPLY,
            'New Student Reply in Discussion',
            `${authorName} replied to "${discussion.title}" in "${module?.title}"`,
            instructorDiscussionLink,
            discussionId,
          );

          await this.emailService
            .sendDiscussionNotificationToInstructor(
              inst.email,
              `${inst.firstName} ${inst.lastName}`.trim(),
              authorName,
              module?.title || '',
              discussion.title,
              instructorDiscussionLink,
            )
            .catch(() => {});
        }),
      );

      // 2. Notify only enrolled students who are "part of this thread"
      //    (the original poster if a student, plus any students who have replied)
      const threadParticipantIds = this.getThreadParticipantStudentIds(
        discussion,
        authorId,
      );

      if (threadParticipantIds.size > 0) {
        const participantEnrollments = await this.enrollmentModel
          .find({
            moduleId: new Types.ObjectId(moduleId),
            studentId: {
              $in: Array.from(threadParticipantIds).map(
                (id) => new Types.ObjectId(id),
              ),
            },
          })
          .populate('studentId', '_id firstName lastName email');

        await Promise.allSettled(
          participantEnrollments.map(async (enrollment) => {
            const student = enrollment.studentId as any;
            if (!student?._id) return;

            await this.notificationsService.createNotification(
              student._id.toString(),
              NotificationType.DISCUSSION_REPLY,
              'New Reply in a Discussion You Participate In',
              `${authorName} replied to "${discussion.title}" in "${module?.title}"`,
              studentDiscussionLink,
              discussionId,
            );

            // Email thread participants so they don't miss follow-ups
            if (student.email) {
              await this.emailService
                .sendDiscussionNotificationToStudent(
                  student.email,
                  `${student.firstName} ${student.lastName}`.trim(),
                  module?.title || '',
                  discussion.moduleTitle || '',
                  discussion.title,
                  studentDiscussionLink,
                  true,
                )
                .catch(() => {});
            }
          }),
        );
      }
    } else {
      // Instructor or admin replied — notify ALL enrolled students (email + dashboard)
      const replyLabel = authorRole === 'admin' ? 'Admin' : 'Instructor';
      const enrollments = await this.enrollmentModel
        .find({ moduleId: new Types.ObjectId(moduleId) })
        .populate('studentId', '_id firstName lastName email');

      await Promise.allSettled(
        enrollments.map(async (enrollment) => {
          const student = enrollment.studentId as any;
          if (!student?.email) return;

          await this.notificationsService.createNotification(
            student._id.toString(),
            NotificationType.DISCUSSION_REPLY,
            `${replyLabel} Replied to Discussion`,
            `${authorName} replied to "${discussion.title}" in "${module?.title}"`,
            studentDiscussionLink,
            discussionId,
          );

          await this.emailService
            .sendDiscussionNotificationToStudent(
              student.email,
              `${student.firstName} ${student.lastName}`.trim(),
              module?.title || '',
              discussion.moduleTitle || '',
              discussion.title,
              studentDiscussionLink,
              true,
            )
            .catch(() => {});
        }),
      );
    }

    return discussion;
  }

  // ---------------------------------------------------------------------------
  // Pin / unpin a discussion (any instructor assigned to the module)
  // ---------------------------------------------------------------------------
  async pinDiscussion(
    discussionId: string,
    userId: string,
    userRole: string,
  ): Promise<Discussion> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    if (userRole !== 'admin') {
      // Verify instructor is assigned to this module
      const module = await this.moduleModel.findById(discussion.moduleId);
      const isAssigned = (module?.instructorIds as any[] | undefined)?.some(
        (id: any) => id.toString() === userId,
      );
      if (!isAssigned) {
        throw new ForbiddenException(
          'Only an assigned instructor can pin or unpin this discussion',
        );
      }
    }

    discussion.isPinned = !discussion.isPinned;
    discussion.pinnedAt = discussion.isPinned ? new Date() : null;
    return discussion.save();
  }

  // ---------------------------------------------------------------------------
  // Resolve / re-open a discussion (assigned instructor or admin)
  // ---------------------------------------------------------------------------
  async resolveDiscussion(
    discussionId: string,
    userId: string,
    userRole: string,
  ): Promise<Discussion> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    if (userRole !== 'admin') {
      const module = await this.moduleModel.findById(discussion.moduleId);
      const isAssigned = (module?.instructorIds as any[] | undefined)?.some(
        (id: any) => id.toString() === userId,
      );
      if (!isAssigned) {
        throw new ForbiddenException(
          'Only an assigned instructor can resolve this discussion',
        );
      }
    }

    discussion.isResolved = !discussion.isResolved;
    discussion.status = discussion.isResolved ? 'resolved' : 'open';
    return discussion.save();
  }

  // ---------------------------------------------------------------------------
  // Admin: get all discussions across the platform
  // ---------------------------------------------------------------------------
  async getAllDiscussionsAdmin(): Promise<Discussion[]> {
    return this.discussionModel
      .find()
      .populate('moduleId', 'title level')
      .populate('instructorId', 'firstName lastName email')
      .populate('studentId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean() as any;
  }

  // ---------------------------------------------------------------------------
  // Delete a discussion (admin or original creator)
  // ---------------------------------------------------------------------------
  async deleteDiscussion(
    discussionId: string,
    userId: string,
    userRole: string,
  ): Promise<{ message: string }> {
    const discussion = await this.discussionModel.findById(discussionId);
    if (!discussion) throw new NotFoundException('Discussion not found');

    if (userRole === 'admin') {
      // Admin can delete any discussion
    } else if (userRole === 'instructor') {
      // Instructor can delete any discussion in their assigned module
      const module = await this.moduleModel.findById(discussion.moduleId);
      const isAssigned = (module?.instructorIds as any[] | undefined)?.some(
        (id: any) => id.toString() === userId,
      );
      if (!isAssigned) {
        throw new ForbiddenException('You are not assigned to this module');
      }
    } else {
      // Student can only delete their own discussion
      if (discussion.createdById.toString() !== userId) {
        throw new ForbiddenException(
          'Not authorized to delete this discussion',
        );
      }
    }

    await this.discussionModel.findByIdAndDelete(discussionId);
    return { message: 'Discussion deleted successfully' };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the set of student participant IDs in a thread, excluding the
   * current replier. A "participant" is the thread creator (if student) plus
   * any previous student repliers.
   */
  private getThreadParticipantStudentIds(
    discussion: Discussion,
    currentAuthorId: string,
  ): Set<string> {
    const participants = new Set<string>();

    if (discussion.createdByRole === 'student') {
      const id = discussion.createdById.toString();
      if (id !== currentAuthorId) participants.add(id);
    }

    for (const reply of discussion.replies) {
      // Only include replies whose authorRole is 'student'
      if ((reply as any).authorRole === 'student') {
        const id = reply.authorId.toString();
        if (id !== currentAuthorId) participants.add(id);
      }
    }

    return participants;
  }

  /**
   * Validates that a user has access to a module's discussions.
   * - Admin: bypassed at controller level
   * - Instructor: must be assigned to the module
   * - Student: must be enrolled
   */
  private async validateModuleAccess(
    moduleId: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    if (!moduleId) throw new BadRequestException('Module ID is required');

    if (userRole === 'instructor') {
      const module = await this.moduleModel.findById(moduleId);
      const isAssigned = (module?.instructorIds as any[] | undefined)?.some(
        (id: any) => id.toString() === userId,
      );
      if (!isAssigned) {
        throw new ForbiddenException('You are not assigned to this module');
      }
      return;
    }

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
