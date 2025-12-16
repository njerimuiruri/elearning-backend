import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserRole, InstructorStatus, FellowshipStatus } from '../schemas/user.schema';
import { Course } from '../schemas/course.schema';
import { PasswordReset } from '../schemas/password-reset.schema';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(PasswordReset.name) private passwordResetModel: Model<PasswordReset>,
    private emailService: EmailService,
  ) {}

  // Dashboard Statistics
  async getDashboardStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      totalStudents,
      totalInstructors,
      pendingInstructors,
      approvedInstructors,
      totalFellows,
      activeFellows,
      publicUsers,
      newUsersLast30Days,
      activeUsersLast30Days,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ isActive: true }),
      this.userModel.countDocuments({ role: UserRole.STUDENT }),
      this.userModel.countDocuments({ role: UserRole.INSTRUCTOR }),
      this.userModel.countDocuments({ 
        role: UserRole.INSTRUCTOR, 
        instructorStatus: InstructorStatus.PENDING 
      }),
      this.userModel.countDocuments({ 
        role: UserRole.INSTRUCTOR, 
        instructorStatus: InstructorStatus.APPROVED 
      }),
      this.userModel.countDocuments({ 'fellowData.fellowId': { $exists: true } }),
      this.userModel.countDocuments({ 
        'fellowData.fellowshipStatus': FellowshipStatus.ACTIVE 
      }),
      this.userModel.countDocuments({ userType: 'public' }),
      this.userModel.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      this.userModel.countDocuments({ 
        lastLogin: { $gte: thirtyDaysAgo },
        isActive: true 
      }),
    ]);

    // Calculate percentage changes
    const userGrowth = totalUsers > 0 ? ((newUsersLast30Days / totalUsers) * 100).toFixed(1) : 0;
    const activeGrowth = activeUsers > 0 ? ((activeUsersLast30Days / activeUsers) * 100).toFixed(1) : 0;

    return {
      totalUsers,
      activeUsers,
      totalStudents,
      totalInstructors,
      pendingInstructors,
      approvedInstructors,
      totalFellows,
      activeFellows,
      publicUsers,
      activeUsersLast30Days,
      newUsersLast30Days,
      userGrowth: `+${userGrowth}%`,
      activeGrowth: `+${activeGrowth}%`,
      fellowsPercentage: totalFellows > 0 ? ((activeFellows / totalFellows) * 100).toFixed(0) : 0,
    };
  }

  // User Management
  async getAllUsers(filters: { role?: string; status?: string; page?: number; limit?: number }) {
    const { role, status, page = 1, limit = 20 } = filters;
    const query: any = {};

    if (role) query.role = role;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string) {
    const user = await this.userModel.findById(id).select('-password').lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { user };
  }

  async updateUserStatus(id: string, isActive: boolean) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { isActive, updatedAt: new Date() },
      { new: true }
    ).select('-password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user,
    };
  }

  async deleteUser(id: string) {
    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { message: 'User deleted successfully' };
  }

  // Instructor Management
  async getPendingInstructors() {
    const instructors = await this.userModel
      .find({
        role: UserRole.INSTRUCTOR,
        instructorStatus: InstructorStatus.PENDING,
      })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    return { instructors };
  }

  async getInstructorDetails(id: string) {
    const instructor = await this.userModel
      .findOne({
        _id: id,
        role: UserRole.INSTRUCTOR,
      })
      .select('-password')
      .lean();

    if (!instructor) {
      throw new NotFoundException('Instructor not found');
    }

    return { instructor };
  }

  async approveInstructor(id: string) {
    const instructor = await this.userModel.findOneAndUpdate(
      {
        _id: id,
        role: UserRole.INSTRUCTOR,
        instructorStatus: InstructorStatus.PENDING,
      },
      {
        instructorStatus: InstructorStatus.APPROVED,
        updatedAt: new Date(),
      },
      { new: true }
    ).select('-password');

    if (!instructor) {
      throw new NotFoundException('Instructor not found or already processed');
    }

    try {
      await this.emailService.sendInstructorApprovalEmail(
        instructor.email,
        instructor.firstName,
        true,
      );
    } catch (error) {
      // Log but do not block approval flow
      console.error('Failed to send instructor approval email:', error);
    }

    // Send notification to admin email
    try {
      await this.emailService.sendInstructorRegistrationNotificationToAdmin(
        'faith.muiruri@strathmore.edu',
        `${instructor.firstName} ${instructor.lastName}`,
        instructor.email,
        instructor.institution || 'Not provided',
        `Status: APPROVED`,
        instructor._id.toString(),
      );
    } catch (error) {
      console.error('Failed to send admin notification:', error);
    }

    return {
      message: 'Instructor approved successfully',
      instructor,
    };
  }

  async rejectInstructor(id: string, reason: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const instructor = await this.userModel.findOneAndUpdate(
      {
        _id: id,
        role: UserRole.INSTRUCTOR,
        instructorStatus: InstructorStatus.PENDING,
      },
      {
        instructorStatus: InstructorStatus.REJECTED,
        updatedAt: new Date(),
      },
      { new: true }
    ).select('-password');

    if (!instructor) {
      throw new NotFoundException('Instructor not found or already processed');
    }

    try {
      await this.emailService.sendInstructorApprovalEmail(
        instructor.email,
        instructor.firstName,
        false,
      );
    } catch (error) {
      // Log but do not block rejection flow
      console.error('Failed to send instructor rejection email:', error);
    }

    // Send notification to admin email
    try {
      await this.emailService.sendInstructorRegistrationNotificationToAdmin(
        'faith.muiruri@strathmore.edu',
        `${instructor.firstName} ${instructor.lastName}`,
        instructor.email,
        instructor.institution || 'Not provided',
        `Status: REJECTED - Reason: ${reason}`,
        instructor._id.toString(),
      );
    } catch (error) {
      console.error('Failed to send admin notification:', error);
    }

    return {
      message: 'Instructor application rejected',
      instructor,
    };
  }

  async getAllInstructors(filters: { status?: string; page?: number; limit?: number }) {
    const { status, page = 1, limit = 20 } = filters;
    const query: any = { role: UserRole.INSTRUCTOR };

    if (status) {
      query.instructorStatus = status;
    }

    const skip = (page - 1) * limit;

    const [instructors, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    return {
      instructors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // Student Management
  async getAllStudents(filters: { page?: number; limit?: number; search?: string } = {}) {
    const { page = 1, limit = 20, search } = filters;
    const query: any = { role: UserRole.STUDENT };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [students, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    return {
      students,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getStudentById(id: string) {
    const student = await this.userModel
      .findOne({
        _id: id,
        role: UserRole.STUDENT,
      })
      .select('-password')
      .lean();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return { student };
  }

  async createStudent(createStudentDto: any) {
    const { firstName, lastName, email, phoneNumber, country } = createStudentDto;

    // Check if student already exists
    const existingStudent = await this.userModel.findOne({ email });
    if (existingStudent) {
      throw new BadRequestException('Student with this email already exists');
    }

    // Generate temporary password
    const temporaryPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    // Create student with mustSetPassword flag
    const student = await this.userModel.create({
      firstName,
      lastName,
      email,
      phoneNumber: phoneNumber || null,
      country: country || null,
      password: hashedPassword,
      role: UserRole.STUDENT,
      isActive: true,
      mustSetPassword: true, // Flag for admin-created student
    });

    // Create password reset token for initial setup
    const setupToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(setupToken).digest('hex');

    await this.passwordResetModel.create({
      userId: student._id,
      email,
      token: hashedToken,
    });

    // Send registration email with credentials
    try {
      await this.emailService.sendStudentRegistrationEmail(email, firstName, temporaryPassword);
    } catch (error) {
      console.error('Failed to send registration email:', error);
      // Don't fail the creation if email fails
    }

    return {
      student: {
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        role: student.role,
      },
      temporaryPassword,
      message: 'Student created successfully. Registration email sent.',
    };
  }

  async bulkCreateStudents(file: Express.Multer.File, bulkDto: any) {
    if (!file && (!bulkDto.students || !Array.isArray(bulkDto.students))) {
      throw new BadRequestException('Please provide either a CSV file or student data');
    }

    let studentsData = bulkDto.students || [];

    // If file provided, parse CSV
    if (file) {
      const csv = require('csv-parser');
      const stream = require('stream');
      const data: any[] = [];

      await new Promise((resolve, reject) => {
        stream.Readable.from([file.buffer.toString()]).
          pipe(csv())
          .on('data', (row: any) => {
            data.push({
              firstName: row.firstName || row['First Name'],
              lastName: row.lastName || row['Last Name'],
              email: row.email || row['Email'],
              phoneNumber: row.phoneNumber || row['Phone Number'] || null,
              country: row.country || row['Country'] || null,
            });
          })
          .on('end', resolve)
          .on('error', reject);
      });

      studentsData = data;
    }

    const results = {
      created: 0,
      failed: 0,
      errors: [] as any[],
      students: [] as any[],
    };

    for (const studentData of studentsData) {
      try {
        // Check if student already exists
        const existingStudent = await this.userModel.findOne({ email: studentData.email });
        if (existingStudent) {
          results.failed++;
          results.errors.push({
            email: studentData.email,
            error: 'Student with this email already exists',
          });
          continue;
        }

        // Generate temporary password
        const temporaryPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

        // Create student
        const student = await this.userModel.create({
          firstName: studentData.firstName,
          lastName: studentData.lastName,
          email: studentData.email,
          phoneNumber: studentData.phoneNumber || null,
          country: studentData.country || null,
          password: hashedPassword,
          role: UserRole.STUDENT,
          isActive: true,
        });

        // Send registration email
        try {
          await this.emailService.sendStudentRegistrationEmail(
            studentData.email,
            studentData.firstName,
            temporaryPassword,
          );
        } catch (emailError) {
          console.error(`Failed to send email to ${studentData.email}:`, emailError);
        }

        results.created++;
        results.students.push({
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
        });
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          email: studentData.email,
          error: error.message,
        });
      }
    }

    return {
      message: `Bulk student creation completed. ${results.created} created, ${results.failed} failed`,
      ...results,
    };
  }

  async updateStudent(id: string, updateData: any) {
    const allowedFields = ['firstName', 'lastName', 'phoneNumber', 'country', 'bio', 'isActive'];
    const filteredData = {};

    for (const field of allowedFields) {
      if (field in updateData) {
        filteredData[field] = updateData[field];
      }
    }

    const student = await this.userModel.findByIdAndUpdate(id, filteredData, {
      new: true,
    }).select('-password');

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return {
      message: 'Student updated successfully',
      student,
    };
  }

  async deleteStudent(id: string) {
    const student = await this.userModel.findByIdAndDelete(id);
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    return { message: 'Student deleted successfully' };
  }

  // Activity Logs
  async getRecentActivity(filters: { limit?: number; type?: string }) {
    const { limit = 10 } = filters;

    // Get recent user registrations
    const recentUsers = await this.userModel
      .find()
      .select('firstName lastName email role createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const activities = recentUsers.map(user => ({
      type: 'user_registration',
      icon: 'UserPlus',
      message: `${user.firstName} ${user.lastName} registered as ${user.role}`,
      timestamp: user.createdAt,
      userId: user._id,
    }));

    return { activities };
  }

  // Fellows Management
  async getAllFellows(filters: { status?: string; page?: number; limit?: number }) {
    const { status, page = 1, limit = 20 } = filters;
    const query: any = { 'fellowData.fellowId': { $exists: true } };

    if (status) {
      query['fellowData.fellowshipStatus'] = status;
    }

    const skip = (page - 1) * limit;

    const [fellows, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('-password')
        .sort({ 'fellowData.deadline': 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    return {
      fellows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getFellowsAtRisk() {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const fellows = await this.userModel
      .find({
        'fellowData.fellowshipStatus': FellowshipStatus.ACTIVE,
        'fellowData.deadline': { $lte: thirtyDaysFromNow },
      })
      .select('-password')
      .sort({ 'fellowData.deadline': 1 })
      .lean();

    // Calculate progress for each fellow
    const fellowsAtRisk = fellows.map(fellow => {
      const daysLeft = Math.ceil(
        (fellow.fellowData.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Mock progress - calculate based on actual course completions in production
      const progress = Math.floor(Math.random() * 50);

      return {
        ...fellow,
        daysLeft,
        progress,
        isAtRisk: daysLeft < 30 && progress < 50,
      };
    }).filter(f => f.isAtRisk);

    return { fellows: fellowsAtRisk };
  }

  async sendFellowReminder(id: string, message: string) {
    const fellow = await this.userModel
      .findOne({
        _id: id,
        'fellowData.fellowId': { $exists: true },
      })
      .select('-password');

    if (!fellow) {
      throw new NotFoundException('Fellow not found');
    }

    // TODO: Implement email sending logic here
    console.log(`Sending reminder to ${fellow.email}: ${message}`);

    return {
      message: 'Reminder sent successfully',
      sentTo: fellow.email,
    };
  }

  // Analytics
  async getUserAnalytics(filters: { startDate?: string; endDate?: string }) {
    const startDate = filters.startDate 
      ? new Date(filters.startDate) 
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    const registrations = await this.userModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            role: '$role',
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { '_id.date': 1 },
      },
    ]);

    return { registrations, startDate, endDate };
  }

  async getRevenueAnalytics(filters: { startDate?: string; endDate?: string }) {
    // Mock revenue data - implement actual revenue tracking in production
    const startDate = filters.startDate 
      ? new Date(filters.startDate) 
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    return {
      totalRevenue: 125678,
      revenue30Days: 125678,
      growthPercentage: 18.4,
      startDate,
      endDate,
    };
  }

  // Course Management
  async getPendingCourses(filters: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = filters;
    const query = { status: 'submitted' };
    const skip = (page - 1) * limit;

    const [courses, total] = await Promise.all([
      this.courseModel
        .find(query)
        .populate('instructorIds', 'firstName lastName email institution')
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.courseModel.countDocuments(query),
    ]);

    return {
      courses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async approveCourse(courseId: string, adminId: string, feedback?: string) {
    // Update course status to approved and published
    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'approved',
        approvedBy: adminId,
        approvedAt: new Date(),
      },
      { new: true },
    ).populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    const instructors = Array.isArray(updatedCourse.instructorIds) ? updatedCourse.instructorIds : [];

    // Send approval email to all instructors
    try {
      for (const instructor of instructors) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor) {
          await this.emailService.sendCourseApprovalEmailToInstructor(
            String(instructor.email),
            String(instructor.firstName),
            updatedCourse.title,
          );
        }
      }
    } catch (error) {
      console.error('Failed to send course approval email:', error);
      // Don't block the approval if email fails
    }

    // Send notification to admin email (use first instructor)
    try {
      const mainInstructor = instructors[0];
      if (mainInstructor && typeof mainInstructor === 'object' && 'firstName' in mainInstructor && 'lastName' in mainInstructor && 'email' in mainInstructor) {
        await this.emailService.sendInstructorRegistrationNotificationToAdmin(
          'faith.muiruri@strathmore.edu',
          `${mainInstructor.firstName || ''} ${mainInstructor.lastName || ''}`,
          String(mainInstructor.email || ''),
          updatedCourse.title,
          `Course APPROVED`,
          updatedCourse._id.toString(),
        );
      }
    } catch (error) {
      console.error('Failed to send admin notification:', error);
    }

    return {
      message: 'Course approved successfully',
      course: updatedCourse,
    };
  }

  async rejectCourse(courseId: string, reason: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    // Update course status to rejected
    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'rejected',
        rejectionReason: reason,
      },
      { new: true },
    ).populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    const instructors = Array.isArray(updatedCourse.instructorIds) ? updatedCourse.instructorIds : [];

    // Send rejection email to all instructors
    try {
      for (const instructor of instructors) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor) {
          await this.emailService.sendCourseRejectionEmailToInstructor(
            String(instructor.email),
            String(instructor.firstName),
            updatedCourse.title,
            reason,
          );
        }
      }
    } catch (error) {
      console.error('Failed to send course rejection email:', error);
      // Don't block the rejection if email fails
    }

    // Send notification to admin email (use first instructor)
    try {
      const mainInstructor = instructors[0];
      if (mainInstructor && typeof mainInstructor === 'object' && 'firstName' in mainInstructor && 'lastName' in mainInstructor && 'email' in mainInstructor) {
        await this.emailService.sendInstructorRegistrationNotificationToAdmin(
          'faith.muiruri@strathmore.edu',
          `${mainInstructor.firstName || ''} ${mainInstructor.lastName || ''}`,
          String(mainInstructor.email || ''),
          updatedCourse.title,
          `Course REJECTED - Reason: ${reason}`,
          updatedCourse._id.toString(),
        );
      }
    } catch (error) {
      console.error('Failed to send admin notification:', error);
    }

    return {
      message: 'Course rejected successfully',
      course: updatedCourse,
    };
  }

  async approvePendingCourse(courseId: string, adminId: string) {
    const course = await this.courseModel.findById(courseId).populate('instructorIds');

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.status !== 'submitted') {
      throw new BadRequestException('Only submitted courses can be approved');
    }

    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'published', // Automatically publish course when approved
        approvedBy: adminId,
        approvedAt: new Date(),
        publishedAt: new Date(),
      },
      { new: true },
    ).populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    // Send approval email to all instructors
    try {
      const instructors = Array.isArray(updatedCourse.instructorIds) ? updatedCourse.instructorIds : [];
      for (const instructor of instructors) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor && 'lastName' in instructor) {
          await this.emailService.sendCourseApprovedEmail(
            String(instructor.email),
            `${instructor.firstName} ${instructor.lastName}`,
            updatedCourse.title,
          );
        }
      }
    } catch (error) {
      console.error('Failed to send course approval email to instructor(s):', error);
      // Don't fail the approval if email fails
    }

    return {
      message: 'Course approved successfully',
      course: updatedCourse,
    };
  }

  async rejectPendingCourse(courseId: string, reason: string) {
    const course = await this.courseModel.findById(courseId).populate('instructorIds');

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.status !== 'submitted') {
      throw new BadRequestException('Only submitted courses can be rejected');
    }

    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'rejected',
        rejectionReason: reason,
        rejectedAt: new Date(),
      },
      { new: true },
    ).populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    // Send rejection email to all instructors
    try {
      const instructors = Array.isArray(updatedCourse.instructorIds) ? updatedCourse.instructorIds : [];
      for (const instructor of instructors) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor && 'lastName' in instructor) {
          await this.emailService.sendCourseRejectedEmail(
            String(instructor.email),
            `${instructor.firstName} ${instructor.lastName}`,
            updatedCourse.title,
            reason,
          );
        }
      }
    } catch (error) {
      console.error('Failed to send course rejection email to instructor(s):', error);
      // Don't block the rejection if email fails
    }

    return {
      message: 'Course rejected successfully',
      course: updatedCourse,
    };
  }

  async getAllCourses(filters: { status?: string; page?: number; limit?: number } = {}) {
    const { status, page = 1, limit = 20 } = filters;
    const query: any = {};

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [courses, total] = await Promise.all([
      this.courseModel
        .find(query)
        .populate('instructorIds', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.courseModel.countDocuments(query),
    ]);

    return {
      courses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getCourseById(courseId: string) {
    const course = await this.courseModel
      .findById(courseId)
      .populate('instructorIds', 'firstName lastName email institution')
      .exec();

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Convert to plain object if needed and ensure all data is included
    const courseData = course.toObject ? course.toObject() : course;
    return courseData;
  }

  async migrateCourses() {
    try {
      // Find all courses
      const courses = await this.courseModel.find({}).exec();
      let migratedCount = 0;
      let alreadyMigratedCount = 0;

      for (const course of courses) {
        let needsUpdate = false;

        // Check if modules need migration (don't have lessons array)
        if (course.modules && course.modules.length > 0) {
          const updatedModules = course.modules.map((module: any) => {
            if (!module.lessons || !Array.isArray(module.lessons)) {
              needsUpdate = true;
              return {
                ...module.toObject ? module.toObject() : module,
                lessons: [], // Add empty lessons array
              };
            }
            return module;
          });

          if (needsUpdate) {
            await this.courseModel.findByIdAndUpdate(
              course._id,
              { modules: updatedModules },
              { new: true }
            );
            migratedCount++;
          } else {
            alreadyMigratedCount++;
          }
        }
      }

      return {
        success: true,
        message: 'Course migration completed',
        totalCourses: courses.length,
        migratedCourses: migratedCount,
        alreadyMigrated: alreadyMigratedCount,
      };
    } catch (error) {
      console.error('Migration error:', error);
      throw new BadRequestException(`Migration failed: ${error.message}`);
    }
  }

  async deleteCourse(courseId: string) {
    const course = await this.courseModel.findById(courseId).populate('instructorIds');

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Delete the course
    await this.courseModel.findByIdAndDelete(courseId);

    // Send deletion notification email to instructor
    try {
      const instructors = Array.isArray(course.instructorIds) ? course.instructorIds : [];
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const dashboardUrl = `${frontendUrl}/instructor/dashboard`;

      for (const instructor of instructors) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor && 'lastName' in instructor) {
          const htmlContent = `
            <h2>Course Deletion Notification</h2>
            <p>Dear ${instructor.firstName} ${instructor.lastName},</p>
            <p>We are writing to inform you that your course <strong>"${course.title}"</strong> has been deleted by an administrator.</p>
            <p><strong>Reason:</strong> Administrative action</p>
            <p>If you believe this was done in error or have any questions, please contact our support team.</p>
            <p>You can visit your instructor dashboard to create new courses:</p>
            <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
            <p>Best regards,<br/>E-Learning Platform Team</p>
          `;
          await this.emailService.sendSimpleEmail(
            String(instructor.email),
            'Course Deletion Notification',
            htmlContent
          );
        }
      }
    } catch (error) {
      console.error('Error sending course deletion email:', error);
      // Don't fail the deletion if email fails
    }

    return {
      message: 'Course deleted successfully',
      courseId,
    };
  }

  // Student Reminder System
  async getStudentsNotFinished(filters: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    const Enrollment = this.userModel.db.model('Enrollment');

    // Find enrollments where isCompleted is false
    const enrollments = await Enrollment.find({ isCompleted: false })
      .populate('userId', 'firstName lastName email institution')
      .populate('courseId', 'title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Enrollment.countDocuments({ isCompleted: false });

    return {
      students: enrollments.map(e => ({
        studentId: e.userId._id,
        studentName: `${e.userId.firstName} ${e.userId.lastName}`,
        email: e.userId.email,
        institution: e.userId.institution,
        courseId: e.courseId._id,
        courseTitle: e.courseId.title,
        enrollmentId: e._id,
        progress: e.progress || 0,
        completedModules: e.completedModules || 0,
        enrolledAt: e.createdAt,
        lastAccessedAt: e.lastAccessedAt,
      })),
      total,
      page,
      limit,
    };
  }

  async sendReminderToStudent(enrollmentId: string, message?: string) {
    const Enrollment = this.userModel.db.model('Enrollment');

    const enrollment = await Enrollment.findById(enrollmentId)
      .populate('userId', 'firstName lastName email')
      .populate('courseId', 'title');

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const student = enrollment.userId;
    const course = enrollment.courseId;
    const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/student`;

    const customMessage = message || `We noticed you haven't finished "${course.title}" yet. Continue your learning journey and complete the course to earn your certificate!`;

    const htmlContent = `
      <h2>Complete Your Course!</h2>
      <p>Hi ${student.firstName},</p>
      <p>${customMessage}</p>
      <p>
        <a href="${dashboardUrl}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Continue Learning</a>
      </p>
      <p>Progress: ${enrollment.progress || 0}% Complete</p>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    try {
      await this.emailService.sendSimpleEmail(
        student.email,
        `Reminder: Complete "${course.title}" Course`,
        htmlContent,
      );
    } catch (error) {
      console.error('Failed to send reminder email:', error);
      throw new BadRequestException('Failed to send reminder email');
    }

    return {
      message: 'Reminder sent successfully',
      student: student.email,
      course: course.title,
    };
  }

  async sendRemindersToMultipleStudents(enrollmentIds: string[], message?: string) {
    const Enrollment = this.userModel.db.model('Enrollment');

    const results: Array<{ message: string; student: any; course: any }> = [];
    const failed: Array<{ enrollmentId: string; error: string }> = [];

    for (const enrollmentId of enrollmentIds) {
      try {
        const result = await this.sendReminderToStudent(enrollmentId, message);
        results.push(result);
      } catch (error) {
        failed.push({ enrollmentId, error: error.message });
      }
    }

    return {
      sent: results.length,
      failed: failed.length,
      results,
      failedDetails: failed,
    };
  }

  async sendRemindersToAllNotFinished(message?: string) {
    const Enrollment = this.userModel.db.model('Enrollment');

    const enrollments = await Enrollment.find({ isCompleted: false })
      .populate('userId', 'firstName lastName email')
      .populate('courseId', 'title');

    return this.sendRemindersToMultipleStudents(
      enrollments.map(e => e._id),
      message,
    );
  }
}