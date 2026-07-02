import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, StudentVerificationStatus } from '../schemas/user.schema';
import { CloudinaryService } from '../common/services/cloudinary.service';
import { EmailService } from '../common/services/email.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StudentVerificationService {
  private readonly logger = new Logger(StudentVerificationService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private cloudinaryService: CloudinaryService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  /**
   * Upload student ID  sets verification status to pending.
   * categoryId is required when uploading before payment (new flow).
   * If the user already has a pendingStudentCategoryId from a prior payment it is preserved.
   */
  async uploadStudentId(
    userId: string,
    fileBuffer: Buffer,
    fileName: string,
    categoryId?: string,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const existingStatus = user.studentVerification?.status;
    if (existingStatus === StudentVerificationStatus.APPROVED) {
      if (user.studentVerification?.awaitingPayment) {
        throw new BadRequestException(
          'Your student ID has already been approved. Please complete your payment.',
        );
      }
      throw new BadRequestException('Your student ID is already verified and active.');
    }

    // Resolve the category: use provided categoryId, or fall back to existing pendingStudentCategoryId
    const resolvedCategoryId = categoryId || user.pendingStudentCategoryId?.toString();
    if (!resolvedCategoryId) {
      throw new BadRequestException('Please specify the category you are applying for.');
    }

    const uploadUrl = await this.cloudinaryService.uploadStudentId(fileBuffer, fileName);

    await this.userModel.findByIdAndUpdate(userId, {
      'studentVerification.status': StudentVerificationStatus.PENDING,
      'studentVerification.idUploadUrl': uploadUrl,
      'studentVerification.submittedAt': new Date(),
      'studentVerification.rejectionReason': null,
      'studentVerification.reviewedAt': null,
      'studentVerification.awaitingPayment': false,
      pendingStudentCategoryId: new Types.ObjectId(resolvedCategoryId),
    });

    this.logger.log(`Student ID uploaded for user ${userId}, category ${resolvedCategoryId}`);

    // Notify admins
    const adminEmails = ['n.mutwii@arin-africa.org', 'f.muiruri@arin-africa.org'];
    const studentName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
    const reviewUrl = `https://elearning.arin-africa.org/admin/student-verifications`;

    try {
      await this.emailService.sendStudentIdSubmissionNotification(
        adminEmails,
        studentName,
        user.email,
        uploadUrl,
        reviewUrl,
      );
    } catch (err) {
      this.logger.warn(`Failed to send admin notification for student ID upload: ${(err as any)?.message || String(err)}`);
    }

    return {
      success: true,
      message: 'Student ID uploaded successfully. Under review.',
      status: StudentVerificationStatus.PENDING,
    };
  }

  /**
   * Get current verification status for a user
   */
  async getVerificationStatus(userId: string) {
    const user = await this.userModel.findById(userId).select(
      'studentVerification pendingStudentCategoryId',
    );
    if (!user) throw new NotFoundException('User not found');

    return {
      status: user.studentVerification?.status || StudentVerificationStatus.NONE,
      idUploadUrl: user.studentVerification?.idUploadUrl || null,
      submittedAt: user.studentVerification?.submittedAt || null,
      reviewedAt: user.studentVerification?.reviewedAt || null,
      rejectionReason: user.studentVerification?.rejectionReason || null,
      pendingCategoryId: user.pendingStudentCategoryId?.toString() || null,
    };
  }

  /**
   * Admin: get all pending verifications
   */
  async getPendingVerifications(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel
        .find({ 'studentVerification.status': StudentVerificationStatus.PENDING })
        .select('firstName lastName email studentVerification pendingStudentCategoryId createdAt')
        .populate('pendingStudentCategoryId', 'name')
        .sort({ 'studentVerification.submittedAt': 1 })
        .skip(skip)
        .limit(limit),
      this.userModel.countDocuments({
        'studentVerification.status': StudentVerificationStatus.PENDING,
      }),
    ]);

    return { users, total, page, limit };
  }

  /**
   * Admin: get all verifications (all statuses)
   */
  async getAllVerifications(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const filter: any = {
      'studentVerification.status': { $ne: StudentVerificationStatus.NONE },
    };
    if (status) filter['studentVerification.status'] = status;

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('firstName lastName email studentVerification pendingStudentCategoryId createdAt')
        .populate('pendingStudentCategoryId', 'name')
        .sort({ 'studentVerification.submittedAt': -1 })
        .skip(skip)
        .limit(limit),
      this.userModel.countDocuments(filter),
    ]);

    return { users, total, page, limit };
  }

  /**
   * Admin: approve a student verification.
   * Marks the student as awaiting payment and sends them a payment-ready email.
   * Access is granted after they complete payment (handled in verifyPayment).
   */
  async approveVerification(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.studentVerification?.status !== StudentVerificationStatus.PENDING) {
      throw new BadRequestException('No pending verification for this user');
    }

    if (!user.pendingStudentCategoryId) {
      throw new BadRequestException('No pending category found for this user');
    }

    // Mark approved + awaiting payment (do NOT grant access yet)
    await this.userModel.findByIdAndUpdate(userId, {
      'studentVerification.status': StudentVerificationStatus.APPROVED,
      'studentVerification.reviewedAt': new Date(),
      'studentVerification.rejectionReason': null,
      'studentVerification.awaitingPayment': true,
    });

    // Send payment-ready email
    const paymentUrl = `https://elearning.arin-africa.org/arin-publishing-academy?pay=student`;
    const firstName = user.firstName || user.fullName?.split(' ')[0] || 'Participant';

    try {
      await this.emailService.sendStudentPaymentReadyEmail(
        user.email,
        firstName,
        paymentUrl,
      );
    } catch (err) {
      this.logger.warn(`Failed to send payment-ready email to ${user.email}: ${(err as any)?.message || String(err)}`);
    }

    this.logger.log(`Student verification approved for user ${userId}  awaiting payment`);

    return {
      success: true,
      message: 'Student verification approved. Payment notification sent.',
    };
  }

  /**
   * Admin: reject a student verification
   */
  async rejectVerification(userId: string, reason: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.studentVerification?.status !== StudentVerificationStatus.PENDING) {
      throw new BadRequestException('No pending verification for this user');
    }

    await this.userModel.findByIdAndUpdate(userId, {
      'studentVerification.status': StudentVerificationStatus.REJECTED,
      'studentVerification.reviewedAt': new Date(),
      'studentVerification.rejectionReason': reason,
      'studentVerification.awaitingPayment': false,
    });

    // Notify the student so they know to re-upload
    const reuploadUrl = `https://elearning.arin-africa.org/arin-publishing-academy`;
    const firstName = user.firstName || user.fullName?.split(' ')[0] || 'Participant';

    try {
      await this.emailService.sendStudentIdRejectionEmail(
        user.email,
        firstName,
        reason,
        reuploadUrl,
      );
    } catch (err) {
      this.logger.warn(`Failed to send rejection email to ${user.email}: ${(err as any)?.message || String(err)}`);
    }

    this.logger.log(`Student verification rejected for user ${userId}: ${reason}`);

    return {
      success: true,
      message: 'Student verification rejected. Student has been notified.',
    };
  }
}
