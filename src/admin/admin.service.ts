import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { User, UserRole, InstructorStatus, FellowshipStatus } from '../schemas/user.schema';
import { Course, CourseStatus } from '../schemas/course.schema';
import { CourseFormat } from '../schemas/course-format.schema';
import { PasswordReset } from '../schemas/password-reset.schema';
import { ActivityLog, ActivityType } from '../schemas/activity-log.schema';
import { Module as ModuleEntity, ModuleStatus } from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class AdminService {
    async setCoursePrice(courseId: string, price: number, adminId: string) {
      if (typeof price !== 'number' || price <= 0) {
        throw new BadRequestException('Price must be a positive number');
      }
      const course = await this.courseModel.findById(courseId);
      if (!course) throw new NotFoundException('Course not found');
      course.price = price;
      course.lastEditedBy = adminId ? new (this.courseModel as any).db.base.Types.ObjectId(adminId) : undefined;
      course.lastEditedAt = new Date();
      await course.save();
      // Optionally log activity
      await this.logActivity(
        ActivityType.COURSE_UPDATED,
        `Course price set to ${price}`,
        adminId,
        undefined,
        courseId,
        { price },
        'DollarSign',
      );
      return { message: 'Course price updated', course };
    }
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(CourseFormat.name) private courseFormatModel: Model<CourseFormat>,
    @InjectModel(PasswordReset.name) private passwordResetModel: Model<PasswordReset>,
    @InjectModel(ActivityLog.name) private activityLogModel: Model<ActivityLog>,
    @InjectModel(ModuleEntity.name) private moduleModel: Model<ModuleEntity>,
    @InjectModel(ModuleEnrollment.name) private moduleEnrollmentModel: Model<ModuleEnrollment>,
    private emailService: EmailService,
  ) {}

  // Helper method to log admin activities
  private async logActivity(
    type: ActivityType,
    message: string,
    performedBy?: string,
    targetUser?: string,
    targetCourse?: string,
    metadata?: Record<string, any>,
    icon?: string,
  ) {
    try {
      await this.activityLogModel.create({
        type,
        message,
        performedBy,
        targetUser,
        targetCourse,
        metadata,
        icon,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Don't throw - logging should not block the main operation
    }
  }

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

    // Get recent activities for dashboard
    const recentActivities = await this.activityLogModel
      .find({
        type: {
          $in: [
            ActivityType.USER_REGISTRATION,
            ActivityType.INSTRUCTOR_APPROVED,
            ActivityType.INSTRUCTOR_REJECTED,
            ActivityType.COURSE_APPROVED,
            ActivityType.COURSE_REJECTED,
          ]
        }
      })
      .populate('performedBy', 'firstName lastName email')
      .populate('targetUser', 'firstName lastName email')
      .populate('targetCourse', 'title')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const activities = recentActivities.map(log => ({
      type: log.type,
      icon: log.icon || 'Activity',
      message: log.message,
      timestamp: log.createdAt,
      performedBy: log.performedBy,
      targetUser: log.targetUser,
      targetCourse: log.targetCourse,
      metadata: log.metadata,
    }));

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
      recentActivities: activities,
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

  async updateUserStatus(id: string, isActive: boolean, adminId?: string) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { isActive, updatedAt: new Date() },
      { new: true }
    ).select('-password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Log the activity
    await this.logActivity(
      isActive ? ActivityType.USER_ACTIVATED : ActivityType.USER_DEACTIVATED,
      `User ${user.firstName} ${user.lastName} has been ${isActive ? 'activated' : 'deactivated'}`,
      adminId,
      user._id.toString(),
      undefined,
      { userEmail: user.email, userRole: user.role },
      isActive ? 'UserCheck' : 'UserX',
    );

    return {
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user,
    };
  }

  async deleteUser(id: string, adminId?: string) {
    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Log the activity
    await this.logActivity(
      ActivityType.USER_DELETED,
      `User ${user.firstName} ${user.lastName} has been deleted`,
      adminId,
      user._id.toString(),
      undefined,
      { userEmail: user.email, userRole: user.role },
      'Trash',
    );

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

    // Format CV display names for all instructors
    const formattedInstructors = instructors.map(instructor => {
      let cvDisplayName: string | null = null;
      if (instructor.cvUrl) {
        const cvPath = instructor.cvUrl.replace(/\\/g, '/');
        const cvFilename = cvPath.split('/').pop();
        
        // Check if it matches our naming pattern: cv-firstname-lastname-timestamp.pdf
        const cvMatch = cvFilename?.match(/^cv-([^-]+)-([^-]+)-\d+-\d+\.pdf$/);
        if (cvMatch) {
          const firstName = cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
          const lastName = cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
          cvDisplayName = `cv-${firstName}-${lastName}.pdf`;
        } else {
          cvDisplayName = cvFilename ?? null;
        }
      }
      
      return {
        ...instructor,
        cvDisplayName,
      };
    });

    return { instructors: formattedInstructors };
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

    // Format CV display name for better UX
    let cvDisplayName: string | null = null;
    if (instructor.cvUrl) {
      const cvPath = instructor.cvUrl.replace(/\\/g, '/');
      const cvFilename = cvPath.split('/').pop();
      
      // Check if it matches our naming pattern: cv-firstname-lastname-timestamp.pdf
      const cvMatch = cvFilename?.match(/^cv-([^-]+)-([^-]+)-\d+-\d+\.pdf$/);
      if (cvMatch) {
        const firstName = cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
        const lastName = cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
        cvDisplayName = `cv-${firstName}-${lastName}.pdf`;
      } else {
        cvDisplayName = cvFilename ?? null;
      }
    }

    return { 
      instructor: {
        ...instructor,
        cvDisplayName,
      }
    };
  }

  async approveInstructor(id: string, adminId?: string) {
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

    // Log the activity
    await this.logActivity(
      ActivityType.INSTRUCTOR_APPROVED,
      `Instructor ${instructor.firstName} ${instructor.lastName} has been approved`,
      adminId,
      instructor._id.toString(),
      undefined,
      { instructorEmail: instructor.email, institution: instructor.institution },
      'CheckCircle',
    );

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

  async rejectInstructor(id: string, reason: string, adminId?: string) {
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

    // Log the activity
    await this.logActivity(
      ActivityType.INSTRUCTOR_REJECTED,
      `Instructor ${instructor.firstName} ${instructor.lastName} application rejected`,
      adminId,
      instructor._id.toString(),
      undefined,
      { reason, instructorEmail: instructor.email, institution: instructor.institution },
      'XCircle',
    );

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

    // Format CV display names for all instructors
    const formattedInstructors = instructors.map(instructor => {
      let cvDisplayName: string | null = null;
      if (instructor.cvUrl) {
        const cvPath = instructor.cvUrl.replace(/\\/g, '/');
        const cvFilename = cvPath.split('/').pop();
        
        // Check if it matches our naming pattern: cv-firstname-lastname-timestamp.pdf
        const cvMatch = cvFilename?.match(/^cv-([^-]+)-([^-]+)-\d+-\d+\.pdf$/);
        if (cvMatch) {
          const firstName = cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
          const lastName = cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
          cvDisplayName = `cv-${firstName}-${lastName}.pdf`;
        } else {
          cvDisplayName = cvFilename ?? null;
        }
      }
      
      return {
        ...instructor,
        cvDisplayName,
      };
    });

    return {
      instructors: formattedInstructors,
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
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      country,
      isFellow,
      assignedCategories
    } = createStudentDto;

    // Check if student already exists
    const existingStudent = await this.userModel.findOne({ email });
    if (existingStudent) {
      throw new BadRequestException('Student with this email already exists');
    }

    // Generate temporary password
    const temporaryPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    // Prepare user data
    const userData: any = {
      firstName,
      lastName,
      email,
      phoneNumber: phoneNumber || null,
      country: country || null,
      password: hashedPassword,
      role: UserRole.STUDENT,
      isActive: true,
      mustSetPassword: true, // Flag for admin-created student
    };

    // If this is a fellow, add fellow data
    if (isFellow) {
      userData.userType = 'fellow';
      userData.fellowData = {
        fellowId: `FELLOW-${Date.now()}`,
        cohort: new Date().getFullYear().toString(),
        deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        requiredCourses: [],
        fellowshipStatus: FellowshipStatus.ACTIVE,
        assignedCategories: assignedCategories && assignedCategories.length > 0
          ? assignedCategories.map((id: string) => new Types.ObjectId(id))
          : [],
      };
    }

    // Create student with mustSetPassword flag
    const student = await this.userModel.create(userData);

    // Log the activity
    await this.logActivity(
      ActivityType.STUDENT_CREATED,
      `Student ${firstName} ${lastName} was created by admin`,
      undefined,
      student._id.toString(),
      undefined,
      { email, country },
      'UserPlus',
    );

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

  async createInstructor(createInstructorDto: any) {
    const { 
      firstName, 
      lastName, 
      email, 
      phoneNumber, 
      country, 
      organization,
      institution,
      bio,
      qualifications,
      expertise,
      linkedIn,
      portfolio,
      teachingExperience,
      yearsOfExperience,
      profilePicture,
      cv
    } = createInstructorDto;

    // Check if instructor already exists
    const existingInstructor = await this.userModel.findOne({ email });
    if (existingInstructor) {
      throw new BadRequestException('Instructor with this email already exists');
    }

    // Generate temporary password
    const temporaryPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    // Create instructor with approved status since admin is creating them
    const instructor = await this.userModel.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      phoneNumber: phoneNumber || null,
      country: country || null,
      organization: organization || null,
      institution: institution || null,
      bio: bio || null,
      qualifications: qualifications || null,
      expertise: expertise || null,
      linkedIn: linkedIn || null,
      portfolio: portfolio || null,
      teachingExperience: teachingExperience || null,
      yearsOfExperience: yearsOfExperience || null,
      profilePicture: profilePicture || null,
      cv: cv || null,
      role: UserRole.INSTRUCTOR,
      instructorStatus: InstructorStatus.APPROVED, // Auto-approve admin-created instructors
      isActive: true,
      mustSetPassword: true, // Flag for admin-created instructor
    });

    // Log the activity
    await this.logActivity(
      ActivityType.INSTRUCTOR_APPROVED,
      `Instructor ${firstName} ${lastName} was created by admin and auto-approved`,
      undefined,
      instructor._id.toString(),
      undefined,
      { email, country, institution },
      'UserCheck',
    );

    // Create password reset token for initial setup
    const setupToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(setupToken).digest('hex');

    await this.passwordResetModel.create({
      userId: instructor._id,
      email,
      token: hashedToken,
    });

    // Send registration email with credentials
    try {
      await this.emailService.sendInstructorRegistrationEmail(email, firstName, temporaryPassword);
    } catch (error) {
      console.error('Failed to send registration email:', error);
      // Don't fail the creation if email fails
    }

    return {
      instructor: {
        _id: instructor._id,
        firstName: instructor.firstName,
        lastName: instructor.lastName,
        email: instructor.email,
        role: instructor.role,
        instructorStatus: instructor.instructorStatus,
      },
      temporaryPassword,
      message: 'Instructor created successfully. Registration email sent.',
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

  async assignFellowCategories(userId: string, categories: string[], adminId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Initialize fellowData if it doesn't exist
    if (!user.fellowData) {
      user.fellowData = { fellowId: new Date().toISOString() } as any;
    }

    // Update assigned categories
    user.fellowData['assignedCategories'] = categories.map((id: string) => new Types.ObjectId(id));
    await user.save();

    await this.logActivity(
      ActivityType.USER_UPDATED,
      `Assigned categories to fellow ${user.firstName} ${user.lastName}`,
      adminId,
      userId,
      undefined,
      { categories },
      'Tag',
    );

    return { message: 'Categories assigned successfully', user };
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

    // Log the activity
    const instructorNames = instructors
      .filter(i => i && typeof i === 'object' && 'firstName' in i)
      .map(i => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
      .join(', ');
    
    await this.logActivity(
      ActivityType.COURSE_APPROVED,
      `Course "${updatedCourse.title}" by ${instructorNames || 'Unknown'} has been approved`,
      adminId,
      undefined,
      updatedCourse._id.toString(),
      { courseTitle: updatedCourse.title, feedback, instructorNames },
      'BookCheck',
    );

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

  async rejectCourse(courseId: string, reason: string, adminId?: string) {
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

    // Log the activity
    const instructorNames = instructors
      .filter(i => i && typeof i === 'object' && 'firstName' in i)
      .map(i => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
      .join(', ');
    
    await this.logActivity(
      ActivityType.COURSE_REJECTED,
      `Course "${updatedCourse.title}" by ${instructorNames || 'Unknown'} has been rejected`,
      adminId,
      undefined,
      updatedCourse._id.toString(),
      { courseTitle: updatedCourse.title, reason, instructorNames },
      'BookX',
    );

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

    // Log the activity
    const instructors = Array.isArray(updatedCourse.instructorIds) ? updatedCourse.instructorIds : [];
    const instructorNames = instructors
      .filter(i => i && typeof i === 'object' && 'firstName' in i)
      .map(i => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
      .join(', ');
    
    await this.logActivity(
      ActivityType.COURSE_APPROVED,
      `Course "${updatedCourse.title}" by ${instructorNames || 'Unknown'} has been approved and published`,
      adminId,
      undefined,
      updatedCourse._id.toString(),
      { courseTitle: updatedCourse.title, instructorNames },
      'CheckCircle',
    );

    // Send approval email to all instructors
    try {
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

  async rejectPendingCourse(courseId: string, reason: string, adminId?: string) {
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

    // Log the activity
    const instructors = Array.isArray(updatedCourse.instructorIds) ? updatedCourse.instructorIds : [];
    const instructorNames = instructors
      .filter(i => i && typeof i === 'object' && 'firstName' in i)
      .map(i => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
      .join(', ');
    
    await this.logActivity(
      ActivityType.COURSE_REJECTED,
      `Course "${updatedCourse.title}" by ${instructorNames || 'Unknown'} has been rejected`,
      adminId,
      undefined,
      updatedCourse._id.toString(),
      { courseTitle: updatedCourse.title, reason, instructorNames },
      'XCircle',
    );

    // Send rejection email to all instructors
    try {
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
      .populate('modules.uploadedBy', 'firstName lastName email institution')
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

  // Analytics Methods
  async getAnalyticsOverview() {
    const Enrollment = this.userModel.db.model('Enrollment');
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalEnrollments,
      completedEnrollments,
      activeEnrollments,
      totalCourses,
      publishedCourses,
      totalStudents,
      approvedInstructors,
    ] = await Promise.all([
      Enrollment.countDocuments(),
      Enrollment.countDocuments({ isCompleted: true }),
      Enrollment.countDocuments({ 
        isCompleted: false,
        lastAccessedAt: { $gte: thirtyDaysAgo }
      }),
      this.courseModel.countDocuments(),
      this.courseModel.countDocuments({ status: CourseStatus.PUBLISHED }),
      this.userModel.countDocuments({ role: UserRole.STUDENT }),
      this.userModel.countDocuments({ role: UserRole.INSTRUCTOR, instructorStatus: InstructorStatus.APPROVED }),
    ]);

    const completionRate = totalEnrollments > 0 
      ? ((completedEnrollments / totalEnrollments) * 100).toFixed(1)
      : 0;

    return {
      enrollments: {
        total: totalEnrollments,
        completed: completedEnrollments,
        active: activeEnrollments,
        completionRate: `${completionRate}%`,
      },
      courses: {
        total: totalCourses,
        published: publishedCourses,
      },
      users: {
        students: totalStudents,
        instructors: approvedInstructors,
      },
    };
  }

  async getStudentProgressAnalytics(limit = 50, status: 'in-progress' | 'completed' | 'all' = 'all') {
    const Enrollment = this.userModel.db.model('Enrollment');

    const filter: any = {};
    if (status === 'in-progress') filter.isCompleted = false;
    if (status === 'completed') filter.isCompleted = true;

    const progressData = await Enrollment.find(filter)
      .populate('studentId', 'firstName lastName email')
      .populate('courseId', 'title')
      .sort({ lastAccessedAt: -1 })
      .limit(limit)
      .lean();

    const students = progressData.map(enrollment => ({
      enrollmentId: enrollment._id,
      status: enrollment.isCompleted ? 'completed' : 'in-progress',
      studentId: enrollment.studentId?._id,
      studentName: `${enrollment.studentId?.firstName} ${enrollment.studentId?.lastName}`,
      studentEmail: enrollment.studentId?.email,
      courseId: enrollment.courseId?._id,
      courseName: enrollment.courseId?.title,
      progress: enrollment.progress || 0,
      lastAccessed: enrollment.lastAccessedAt,
      enrolledAt: enrollment.enrolledAt,
      daysEnrolled: Math.floor((new Date().getTime() - new Date(enrollment.enrolledAt).getTime()) / (1000 * 60 * 60 * 24)),
    }));

    const avgProgress = students.length > 0
      ? students.reduce((sum, s) => sum + s.progress, 0) / students.length
      : 0;

    return {
      students,
      summary: {
        totalActive: students.length,
        averageProgress: avgProgress.toFixed(1),
      },
    };
  }

  async getInstructorActivityAnalytics() {
    const instructors = await this.userModel
      .find({ role: UserRole.INSTRUCTOR })
      .select('firstName lastName email instructorStatus lastLogin createdAt')
      .lean();

    const instructorActivity = await Promise.all(
      instructors.map(async (instructor) => {
        const courses = await this.courseModel
          .find({ instructorIds: instructor._id })
          .select('title status publishedAt enrollmentCount')
          .lean();

        const totalStudents = courses.reduce((sum, course) => sum + (course.enrollmentCount || 0), 0);

        return {
          instructorId: instructor._id,
          name: `${instructor.firstName} ${instructor.lastName}`,
          email: instructor.email,
          status: instructor.instructorStatus,
          coursesCreated: courses.length,
          publishedCourses: courses.filter(c => c.status === CourseStatus.PUBLISHED || !!c.publishedAt).length,
          pendingApproval: courses.filter(c => c.status === CourseStatus.SUBMITTED).length,
          totalStudents,
          lastLogin: instructor.lastLogin,
          joinedAt: instructor.createdAt,
        };
      })
    );

    return {
      instructors: instructorActivity,
      summary: {
        total: instructors.length,
        approved: instructors.filter(i => i.instructorStatus === InstructorStatus.APPROVED).length,
        pending: instructors.filter(i => i.instructorStatus === InstructorStatus.PENDING).length,
      },
    };
  }

  async getCourseCompletionAnalytics() {
    const Enrollment = this.userModel.db.model('Enrollment');

    const completionStats = await Enrollment.aggregate([
      {
        $group: {
          _id: '$courseId',
          totalEnrollments: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] }
          },
          avgProgress: { $avg: '$progress' },
        }
      },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: '_id',
          as: 'course'
        }
      },
      { $unwind: '$course' },
      {
        $project: {
          courseId: '$_id',
          courseName: '$course.title',
          totalEnrollments: 1,
          completedCount: 1,
          completionRate: {
            $multiply: [
              { $divide: ['$completedCount', '$totalEnrollments'] },
              100
            ]
          },
          avgProgress: { $round: ['$avgProgress', 1] },
        }
      },
      { $sort: { completionRate: -1 } }
    ]);

    const overallStats = await Enrollment.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] } },
          avgProgress: { $avg: '$progress' }
        }
      }
    ]);

    const overall = overallStats[0] || { total: 0, completed: 0, avgProgress: 0 };
    const overallCompletionRate = overall.total > 0 
      ? ((overall.completed / overall.total) * 100).toFixed(1)
      : 0;

    return {
      courses: completionStats,
      overall: {
        totalEnrollments: overall.total,
        completedEnrollments: overall.completed,
        completionRate: `${overallCompletionRate}%`,
        averageProgress: overall.avgProgress.toFixed(1),
      },
    };
  }

  async deleteInstructor(id: string) {
    const instructor = await this.userModel.findOne({
      _id: id,
      role: UserRole.INSTRUCTOR,
    });

    if (!instructor) {
      throw new NotFoundException('Instructor not found');
    }

    // Get all courses by this instructor
    const courses = await this.courseModel.find({ instructorIds: id });
    const courseIds = courses.map(c => c._id);

    // Delete related data
    const Enrollment = this.userModel.db.model('Enrollment');
    const Question = this.userModel.db.model('Question');
    const Certificate = this.userModel.db.model('Certificate');

    await Promise.all([
      // Delete courses
      this.courseModel.deleteMany({ instructorIds: id }),
      // Delete enrollments for those courses
      Enrollment.deleteMany({ courseId: { $in: courseIds } }),
      // Delete questions for those courses
      Question.deleteMany({ courseId: { $in: courseIds } }),
      // Delete certificates for those courses
      Certificate.deleteMany({ courseId: { $in: courseIds } }),
      // Finally delete the instructor user
      this.userModel.findByIdAndDelete(id),
    ]);

    return {
      message: 'Instructor and all associated data deleted successfully',
      deletedCourses: courses.length,
    };
  }

  // Activity Logs
  async getRecentActivity(filters: { limit?: number; type?: string } = {}) {
    const { limit = 50, type } = filters;
    const query: any = {};

    if (type) {
      query.type = type;
    }

    const activities = await this.activityLogModel
      .find(query)
      .populate('performedBy', 'firstName lastName email role')
      .populate('targetUser', 'firstName lastName email role')
      .populate('targetCourse', 'title')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const formattedActivities = activities.map((log: any) => ({
      _id: log._id,
      type: log.type,
      icon: log.icon || 'Activity',
      message: log.message,
      timestamp: log.createdAt,
      performedBy: log.performedBy ? {
        _id: log.performedBy?._id || null,
        name: log.performedBy?.firstName && log.performedBy?.lastName 
          ? `${log.performedBy.firstName} ${log.performedBy.lastName}`
          : 'Unknown',
        email: log.performedBy?.email || null,
        role: log.performedBy?.role || null,
      } : null,
      targetUser: log.targetUser ? {
        _id: log.targetUser?._id || null,
        name: log.targetUser?.firstName && log.targetUser?.lastName
          ? `${log.targetUser.firstName} ${log.targetUser.lastName}`
          : 'Unknown',
        email: log.targetUser?.email || null,
        role: log.targetUser?.role || null,
      } : null,
      targetCourse: log.targetCourse ? {
        _id: log.targetCourse?._id || null,
        title: log.targetCourse?.title || 'Unknown',
      } : null,
      metadata: log.metadata,
    }));

    return {
      activities: formattedActivities,
      total: await this.activityLogModel.countDocuments(query),
    };
  }

  // Course Format Management Methods
  async uploadCourseFormat(
    file: Express.Multer.File,
    description?: string,
    version?: string,
    uploadedBy?: string,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('No file provided');
      }

      // Validate file type
      const allowedExtensions = ['pdf', 'doc', 'docx'];
      const fileExtension = path.extname(file.originalname).toLowerCase().replace('.', '');
      
      if (!allowedExtensions.includes(fileExtension)) {
        throw new BadRequestException('Only PDF and DOC files are allowed');
      }

      // Create uploads directory if it doesn't exist
      const courseFormatsDir = path.join(process.cwd(), 'uploads', 'course-formats');
      if (!fs.existsSync(courseFormatsDir)) {
        fs.mkdirSync(courseFormatsDir, { recursive: true });
      }

      // Generate unique filename
      const timestamp = Date.now();
      const uniqueFileName = `format-${timestamp}-${file.originalname}`;
      const filePath = path.join(courseFormatsDir, uniqueFileName);

      // Save file
      fs.writeFileSync(filePath, file.buffer);

      // Check if course format already exists and deactivate it
      const existingFormat = await this.courseFormatModel.findOne({ isActive: true });
      if (existingFormat) {
        existingFormat.isActive = false;
        await existingFormat.save();
      }

      // Create new course format record
      const courseFormat = await this.courseFormatModel.create({
        fileName: file.originalname,
        filePath: `uploads/course-formats/${uniqueFileName}`,
        fileType: fileExtension,
        fileSize: file.size,
        description,
        version,
        uploadedBy,
        uploadedAt: new Date(),
        isActive: true,
      });

      // Log activity
      await this.logActivity(
        ActivityType.FILE_UPLOADED,
        `Course format document uploaded: ${file.originalname}`,
        uploadedBy,
        undefined,
        undefined,
        { fileName: file.originalname, version, description },
        'FileUp',
      );

      return {
        success: true,
        message: 'Course format uploaded successfully',
        courseFormat,
      };
    } catch (error) {
      throw new BadRequestException(error.message || 'Failed to upload course format');
    }
  }

  async getCourseFormat() {
    try {
      const courseFormat = await this.courseFormatModel
        .findOne({ isActive: true })
        .sort({ uploadedAt: -1 });

      if (!courseFormat) {
        return {
          success: false,
          message: 'No course format document found',
          courseFormat: null,
        };
      }

      return {
        success: true,
        courseFormat,
      };
    } catch (error) {
      throw new BadRequestException(error.message || 'Failed to fetch course format');
    }
  }

  async deleteCourseFormat(id: string) {
    try {
      const courseFormat = await this.courseFormatModel.findById(id);

      if (!courseFormat) {
        throw new NotFoundException('Course format not found');
      }

      // Delete the file from disk
      if (fs.existsSync(courseFormat.filePath)) {
        fs.unlinkSync(courseFormat.filePath);
      }

      // Delete from database
      await this.courseFormatModel.findByIdAndDelete(id);

      // Log activity
      await this.logActivity(
        ActivityType.FILE_DELETED,
        `Course format document deleted: ${courseFormat.fileName}`,
        undefined,
        undefined,
        undefined,
        { fileName: courseFormat.fileName },
        'FileX',
      );

      return {
        success: true,
        message: 'Course format deleted successfully',
      };
    } catch (error) {
      throw new BadRequestException(error.message || 'Failed to delete course format');
    }
  }

  // ===================== MODULE MANAGEMENT =====================

  async getAllModules(filters: { status?: string; level?: string; category?: string; page?: number; limit?: number } = {}) {
    const { status, level, category, page = 1, limit = 20 } = filters;
    const query: any = {};

    if (status) query.status = status;
    if (level) query.level = level;
    if (category) query.categoryId = new Types.ObjectId(category);

    const skip = (page - 1) * limit;

    const [modules, total] = await Promise.all([
      this.moduleModel
        .find(query)
        .populate('instructorIds', 'firstName lastName email')
        .populate('categoryId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.moduleModel.countDocuments(query),
    ]);

    return {
      modules,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getPendingModules(filters: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = filters;
    const query = { status: ModuleStatus.SUBMITTED };
    const skip = (page - 1) * limit;

    const [modules, total] = await Promise.all([
      this.moduleModel
        .find(query)
        .populate('instructorIds', 'firstName lastName email institution')
        .populate('categoryId', 'name')
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.moduleModel.countDocuments(query),
    ]);

    return {
      modules,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getModuleById(moduleId: string) {
    const moduleDoc = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds', 'firstName lastName email institution')
      .populate('categoryId', 'name price isPaid')
      .populate('approvedBy', 'firstName lastName')
      .lean();

    if (!moduleDoc) {
      throw new NotFoundException('Module not found');
    }

    // Get enrollment stats for this module
    const enrollmentStats = await this.moduleEnrollmentModel.aggregate([
      { $match: { moduleId: new Types.ObjectId(moduleId) } },
      {
        $group: {
          _id: null,
          totalEnrollments: { $sum: 1 },
          completedCount: { $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] } },
          avgProgress: { $avg: '$overallProgress' },
        },
      },
    ]);

    const stats = enrollmentStats[0] || { totalEnrollments: 0, completedCount: 0, avgProgress: 0 };

    return {
      ...moduleDoc,
      enrollmentStats: {
        totalEnrollments: stats.totalEnrollments,
        completedCount: stats.completedCount,
        completionRate: stats.totalEnrollments > 0
          ? Math.round((stats.completedCount / stats.totalEnrollments) * 100)
          : 0,
        avgProgress: Math.round(stats.avgProgress || 0),
      },
    };
  }

  async approveModule(moduleId: string, adminId: string) {
    const moduleDoc = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds');

    if (!moduleDoc) {
      throw new NotFoundException('Module not found');
    }

    if (moduleDoc.status !== ModuleStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted modules can be approved');
    }

    moduleDoc.status = ModuleStatus.APPROVED;
    moduleDoc.approvedBy = new Types.ObjectId(adminId);
    moduleDoc.approvedAt = new Date();
    await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_APPROVED,
      `Module "${moduleDoc.title}" has been approved`,
      adminId,
      undefined,
      undefined,
      { moduleId, moduleTitle: moduleDoc.title },
      'CheckCircle',
    );

    // Send approval email to each instructor
    try {
      for (const instructor of moduleDoc.instructorIds as any[]) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor) {
          await this.emailService.sendModuleApprovalEmailToInstructor(
            String(instructor.email),
            String(instructor.firstName || ''),
            moduleDoc.title,
          );
        }
      }
    } catch (error) {
      console.error('Failed to send module approval email:', error);
    }

    return { message: 'Module approved successfully', module: moduleDoc };
  }

  async publishModule(moduleId: string, adminId: string) {
    const moduleDoc = await this.moduleModel.findById(moduleId);

    if (!moduleDoc) {
      throw new NotFoundException('Module not found');
    }

    if (moduleDoc.status !== ModuleStatus.APPROVED) {
      throw new BadRequestException('Only approved modules can be published');
    }

    moduleDoc.status = ModuleStatus.PUBLISHED;
    moduleDoc.publishedAt = new Date();
    await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_APPROVED,
      `Module "${moduleDoc.title}" has been published`,
      adminId,
      undefined,
      undefined,
      { moduleId, moduleTitle: moduleDoc.title },
      'Globe',
    );

    return { message: 'Module published successfully', module: moduleDoc };
  }

  async rejectModule(moduleId: string, reason: string, adminId?: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const moduleDoc = await this.moduleModel
      .findById(moduleId)
      .populate('instructorIds');

    if (!moduleDoc) {
      throw new NotFoundException('Module not found');
    }

    if (moduleDoc.status !== ModuleStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted modules can be rejected');
    }

    moduleDoc.status = ModuleStatus.REJECTED;
    moduleDoc.rejectionReason = reason;
    await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_REJECTED,
      `Module "${moduleDoc.title}" has been rejected`,
      adminId,
      undefined,
      undefined,
      { moduleId, moduleTitle: moduleDoc.title, reason },
      'XCircle',
    );

    // Send rejection email to each instructor
    try {
      for (const instructor of moduleDoc.instructorIds as any[]) {
        if (instructor && typeof instructor === 'object' && 'email' in instructor) {
          await this.emailService.sendModuleRejectionEmailToInstructor(
            String(instructor.email),
            String(instructor.firstName || ''),
            moduleDoc.title,
            reason,
          );
        }
      }
    } catch (error) {
      console.error('Failed to send module rejection email:', error);
    }

    return { message: 'Module rejected', module: moduleDoc };
  }

  async getModuleDashboardStats() {
    const [
      totalModules,
      draftModules,
      submittedModules,
      approvedModules,
      publishedModules,
      rejectedModules,
      totalModuleEnrollments,
      completedModuleEnrollments,
    ] = await Promise.all([
      this.moduleModel.countDocuments(),
      this.moduleModel.countDocuments({ status: ModuleStatus.DRAFT }),
      this.moduleModel.countDocuments({ status: ModuleStatus.SUBMITTED }),
      this.moduleModel.countDocuments({ status: ModuleStatus.APPROVED }),
      this.moduleModel.countDocuments({ status: ModuleStatus.PUBLISHED }),
      this.moduleModel.countDocuments({ status: ModuleStatus.REJECTED }),
      this.moduleEnrollmentModel.countDocuments(),
      this.moduleEnrollmentModel.countDocuments({ isCompleted: true }),
    ]);

    const moduleCompletionRate = totalModuleEnrollments > 0
      ? ((completedModuleEnrollments / totalModuleEnrollments) * 100).toFixed(1)
      : '0';

    return {
      totalModules,
      modulesByStatus: {
        draft: draftModules,
        submitted: submittedModules,
        approved: approvedModules,
        published: publishedModules,
        rejected: rejectedModules,
      },
      totalModuleEnrollments,
      completedModuleEnrollments,
      moduleCompletionRate: `${moduleCompletionRate}%`,
    };
  }
}