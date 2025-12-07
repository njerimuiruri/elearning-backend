import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, InstructorStatus } from '../schemas/user.schema';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private emailService: EmailService,
  ) {}

  async findAll(filters?: any) {
    const query = this.userModel.find(filters || {});
    return query.select('-password').sort({ createdAt: -1 }).exec();
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).select('-password');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email }).select('-password');
  }

  async updateUser(id: string, updateData: Partial<User>) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true },
    ).select('-password');

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async deleteUser(id: string) {
    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { message: 'User deleted successfully' };
  }

  async getUserStats() {
    const totalUsers = await this.userModel.countDocuments();
    const students = await this.userModel.countDocuments({ role: 'student' });
    const instructors = await this.userModel.countDocuments({ role: 'instructor' });
    const fellows = await this.userModel.countDocuments({ userType: 'fellow' });

    return {
      totalUsers,
      students,
      instructors,
      fellows,
    };
  }

  async getPendingInstructors() {
    const pendingInstructors = await this.userModel
      .find({ role: 'instructor', instructorStatus: InstructorStatus.PENDING })
      .select('-password')
      .sort({ createdAt: -1 })
      .exec();
    return pendingInstructors;
  }

  async approveInstructor(instructorId: string) {
    const instructor = await this.userModel.findById(instructorId);
    
    if (!instructor) {
      throw new NotFoundException('Instructor not found');
    }

    if (instructor.role !== 'instructor') {
      throw new BadRequestException('User is not an instructor');
    }

    if (instructor.instructorStatus === InstructorStatus.APPROVED) {
      throw new BadRequestException('This instructor is already approved');
    }

    // Update instructor status to approved
    instructor.instructorStatus = InstructorStatus.APPROVED;
    await instructor.save();

    // Send approval email to instructor
    try {
      await this.emailService.sendInstructorApprovalEmail(
        instructor.email,
        instructor.firstName,
        true,
      );
    } catch (error) {
      console.error('Failed to send approval email:', error);
      // Don't fail the approval if email fails
    }

    return {
      message: 'Instructor approved successfully',
      user: this.sanitizeUser(instructor),
    };
  }

  async rejectInstructor(instructorId: string) {
    const instructor = await this.userModel.findById(instructorId);
    
    if (!instructor) {
      throw new NotFoundException('Instructor not found');
    }

    if (instructor.role !== 'instructor') {
      throw new BadRequestException('User is not an instructor');
    }

    if (instructor.instructorStatus === InstructorStatus.REJECTED) {
      throw new BadRequestException('This instructor is already rejected');
    }

    // Update instructor status to rejected
    instructor.instructorStatus = InstructorStatus.REJECTED;
    await instructor.save();

    // Send rejection email to instructor
    try {
      await this.emailService.sendInstructorApprovalEmail(
        instructor.email,
        instructor.firstName,
        false,
      );
    } catch (error) {
      console.error('Failed to send rejection email:', error);
      // Don't fail the rejection if email fails
    }

    return {
      message: 'Instructor rejected successfully',
      user: this.sanitizeUser(instructor),
    };
  }

  private sanitizeUser(user: User) {
    const userObj = user.toObject ? user.toObject() : user;
    delete userObj.password;
    return userObj;
  }
}