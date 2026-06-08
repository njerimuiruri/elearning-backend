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
import { CategoryAccessControlService } from '../categories/access-control.service';

@Injectable()
export class StudentVerificationService {
  private readonly logger = new Logger(StudentVerificationService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private cloudinaryService: CloudinaryService,
    private categoryAccessControl: CategoryAccessControlService,
  ) {}

  /**
   * Upload student ID — sets verification status to pending
   */
  async uploadStudentId(userId: string, fileBuffer: Buffer, fileName: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.pendingStudentCategoryId) {
      throw new BadRequestException(
        'No pending student payment found. Please pay first.',
      );
    }

    const existingStatus = user.studentVerification?.status;
    if (existingStatus === StudentVerificationStatus.APPROVED) {
      throw new BadRequestException('Your student ID is already verified.');
    }

    // Upload to Cloudinary under student-ids folder
    const uploadUrl = await this.cloudinaryService.uploadStudentId(
      fileBuffer,
      fileName,
    );

    await this.userModel.findByIdAndUpdate(userId, {
      'studentVerification.status': StudentVerificationStatus.PENDING,
      'studentVerification.idUploadUrl': uploadUrl,
      'studentVerification.submittedAt': new Date(),
      'studentVerification.rejectionReason': null,
      'studentVerification.reviewedAt': null,
    });

    this.logger.log(`Student ID uploaded for user ${userId}`);

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
   * Admin: approve a student verification → grant category access
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

    const categoryId = user.pendingStudentCategoryId.toString();

    // Grant category access
    await this.categoryAccessControl.markCategoryAsPurchased(userId, categoryId);

    // Update verification status
    await this.userModel.findByIdAndUpdate(userId, {
      'studentVerification.status': StudentVerificationStatus.APPROVED,
      'studentVerification.reviewedAt': new Date(),
      'studentVerification.rejectionReason': null,
      pendingStudentCategoryId: null,
    });

    this.logger.log(`Student verification approved for user ${userId}`);

    return {
      success: true,
      message: 'Student verification approved. Access granted.',
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
    });

    this.logger.log(`Student verification rejected for user ${userId}: ${reason}`);

    return {
      success: true,
      message: 'Student verification rejected.',
    };
  }
}
