import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  User,
  UserRole,
  InstructorStatus,
  FellowshipStatus,
} from '../schemas/user.schema';
import { Course, CourseStatus } from '../schemas/course.schema';
import { CourseFormat } from '../schemas/course-format.schema';
import { PasswordReset } from '../schemas/password-reset.schema';
import { ActivityLog, ActivityType } from '../schemas/activity-log.schema';
import {
  Module as ModuleEntity,
  ModuleStatus,
  AssessmentReviewStatus,
} from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { Category } from '../schemas/category.schema';
import { EmailService } from '../common/services/email.service';
import { CreateModuleDto } from '../modules/dto/create-module.dto';
import { UpdateModuleDto } from '../modules/dto/update-module.dto';

@Injectable()
export class AdminService {
  async setCoursePrice(courseId: string, price: number, adminId: string) {
    if (typeof price !== 'number' || price <= 0) {
      throw new BadRequestException('Price must be a positive number');
    }
    const course = await this.courseModel.findById(courseId);
    if (!course) throw new NotFoundException('Course not found');
    course.price = price;
    course.lastEditedBy = adminId
      ? new (this.courseModel as any).db.base.Types.ObjectId(adminId)
      : undefined;
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
    @InjectModel(CourseFormat.name)
    private courseFormatModel: Model<CourseFormat>,
    @InjectModel(PasswordReset.name)
    private passwordResetModel: Model<PasswordReset>,
    @InjectModel(ActivityLog.name) private activityLogModel: Model<ActivityLog>,
    @InjectModel(ModuleEntity.name) private moduleModel: Model<ModuleEntity>,
    @InjectModel(ModuleEnrollment.name)
    private moduleEnrollmentModel: Model<ModuleEnrollment>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
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
        instructorStatus: InstructorStatus.PENDING,
      }),
      this.userModel.countDocuments({
        role: UserRole.INSTRUCTOR,
        instructorStatus: InstructorStatus.APPROVED,
      }),
      this.userModel.countDocuments({
        'fellowData.fellowId': { $exists: true },
      }),
      this.userModel.countDocuments({
        'fellowData.fellowshipStatus': FellowshipStatus.ACTIVE,
      }),
      this.userModel.countDocuments({ userType: 'public' }),
      this.userModel.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      this.userModel.countDocuments({
        lastLogin: { $gte: thirtyDaysAgo },
        isActive: true,
      }),
    ]);

    // Calculate percentage changes
    const userGrowth =
      totalUsers > 0 ? ((newUsersLast30Days / totalUsers) * 100).toFixed(1) : 0;
    const activeGrowth =
      activeUsers > 0
        ? ((activeUsersLast30Days / activeUsers) * 100).toFixed(1)
        : 0;

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
          ],
        },
      })
      .populate('performedBy', 'firstName lastName email')
      .populate('targetUser', 'firstName lastName email')
      .populate('targetCourse', 'title')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const activities = recentActivities.map((log) => ({
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
      fellowsPercentage:
        totalFellows > 0
          ? ((activeFellows / totalFellows) * 100).toFixed(0)
          : 0,
      recentActivities: activities,
    };
  }

  // User Management
  async getAllUsers(filters: {
    role?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
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
    const user = await this.userModel
      .findByIdAndUpdate(id, { isActive, updatedAt: new Date() }, { new: true })
      .select('-password');

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
    const formattedInstructors = instructors.map((instructor) => {
      let cvDisplayName: string | null = null;
      if (instructor.cvUrl) {
        const cvPath = instructor.cvUrl.replace(/\\/g, '/');
        const cvFilename = cvPath.split('/').pop();

        // Check if it matches our naming pattern: cv-firstname-lastname-timestamp.pdf
        const cvMatch = cvFilename?.match(/^cv-([^-]+)-([^-]+)-\d+-\d+\.pdf$/);
        if (cvMatch) {
          const firstName =
            cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
          const lastName =
            cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
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
        const firstName =
          cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
        const lastName =
          cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
        cvDisplayName = `cv-${firstName}-${lastName}.pdf`;
      } else {
        cvDisplayName = cvFilename ?? null;
      }
    }

    return {
      instructor: {
        ...instructor,
        cvDisplayName,
      },
    };
  }

  async approveInstructor(id: string, adminId?: string) {
    const instructor = await this.userModel
      .findOneAndUpdate(
        {
          _id: id,
          role: UserRole.INSTRUCTOR,
          instructorStatus: InstructorStatus.PENDING,
        },
        {
          instructorStatus: InstructorStatus.APPROVED,
          updatedAt: new Date(),
        },
        { new: true },
      )
      .select('-password');

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
      {
        instructorEmail: instructor.email,
        institution: instructor.institution,
      },
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

    // Link any modules that were pre-assigned to this instructor via email
    await this.linkPendingModules(instructor._id.toString(), instructor.email);

    return {
      message: 'Instructor approved successfully',
      instructor,
    };
  }

  async rejectInstructor(id: string, reason: string, adminId?: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const instructor = await this.userModel
      .findOneAndUpdate(
        {
          _id: id,
          role: UserRole.INSTRUCTOR,
          instructorStatus: InstructorStatus.PENDING,
        },
        {
          instructorStatus: InstructorStatus.REJECTED,
          updatedAt: new Date(),
        },
        { new: true },
      )
      .select('-password');

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
      {
        reason,
        instructorEmail: instructor.email,
        institution: instructor.institution,
      },
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

  async getAllInstructors(filters: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
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
    const formattedInstructors = instructors.map((instructor) => {
      let cvDisplayName: string | null = null;
      if (instructor.cvUrl) {
        const cvPath = instructor.cvUrl.replace(/\\/g, '/');
        const cvFilename = cvPath.split('/').pop();

        // Check if it matches our naming pattern: cv-firstname-lastname-timestamp.pdf
        const cvMatch = cvFilename?.match(/^cv-([^-]+)-([^-]+)-\d+-\d+\.pdf$/);
        if (cvMatch) {
          const firstName =
            cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
          const lastName =
            cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
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
  async getAllStudents(
    filters: { page?: number; limit?: number; search?: string } = {},
  ) {
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
      assignedCategories,
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
        assignedCategories:
          assignedCategories && assignedCategories.length > 0
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
    const hashedToken = crypto
      .createHash('sha256')
      .update(setupToken)
      .digest('hex');

    await this.passwordResetModel.create({
      userId: student._id,
      email,
      token: hashedToken,
    });

    // Fetch category names if assigned
    let categoryNames: string[] = [];
    if (assignedCategories && assignedCategories.length > 0) {
      const categories = await this.categoryModel
        .find({
          _id: {
            $in: assignedCategories.map((id: string) => new Types.ObjectId(id)),
          },
        })
        .select('name')
        .lean();
      categoryNames = categories.map((c: any) => c.name);
    }

    // Send registration email with credentials
    try {
      await this.emailService.sendStudentRegistrationEmail(
        email,
        firstName,
        temporaryPassword,
        categoryNames,
      );
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
      cv,
    } = createInstructorDto;

    // Check if instructor already exists
    const existingInstructor = await this.userModel.findOne({ email });
    if (existingInstructor) {
      throw new BadRequestException(
        'Instructor with this email already exists',
      );
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
    const hashedToken = crypto
      .createHash('sha256')
      .update(setupToken)
      .digest('hex');

    await this.passwordResetModel.create({
      userId: instructor._id,
      email,
      token: hashedToken,
    });

    // Send registration email with credentials
    try {
      await this.emailService.sendInstructorRegistrationEmail(
        email,
        firstName,
        temporaryPassword,
      );
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
      throw new BadRequestException(
        'Please provide either a CSV file or student data',
      );
    }

    let studentsData = bulkDto.students || [];

    // If file provided, parse CSV
    if (file) {
      const csv = require('csv-parser');
      const stream = require('stream');
      const data: any[] = [];

      await new Promise((resolve, reject) => {
        stream.Readable.from([file.buffer.toString()])
          .pipe(csv())
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
        const existingStudent = await this.userModel.findOne({
          email: studentData.email,
        });
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
          console.error(
            `Failed to send email to ${studentData.email}:`,
            emailError,
          );
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
    const allowedFields = [
      'firstName',
      'lastName',
      'phoneNumber',
      'country',
      'bio',
      'isActive',
    ];
    const filteredData = {};

    for (const field of allowedFields) {
      if (field in updateData) {
        filteredData[field] = updateData[field];
      }
    }

    const student = await this.userModel
      .findByIdAndUpdate(id, filteredData, {
        new: true,
      })
      .select('-password');

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

  // ─── Fellow CRUD ──────────────────────────────────────────────────

  async createFellow(dto: any) {
    const {
      fullName,
      firstName,
      lastName,
      email,
      gender,
      country,
      region,
      track,
      category,
      phoneNumber,
      sendEmail,
    } = dto;

    if (!email) throw new BadRequestException('Email is required');

    const existing = await this.userModel.findOne({ email });
    if (existing)
      throw new BadRequestException(
        `A user with email ${email} already exists`,
      );

    const temporaryPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    const fellow = await this.userModel.create({
      fullName: fullName || `${firstName || ''} ${lastName || ''}`.trim(),
      firstName: firstName || '',
      lastName: lastName || '',
      email,
      gender: gender || null,
      country: country || null,
      phoneNumber: phoneNumber || null,
      password: hashedPassword,
      role: UserRole.STUDENT,
      userType: 'fellow',
      isActive: true,
      mustSetPassword: true,
      invitationEmailSent: false,
      fellowData: {
        fellowId: `FELLOW-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
        cohort: new Date().getFullYear().toString(),
        deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        requiredCourses: [],
        fellowshipStatus: FellowshipStatus.ACTIVE,
        assignedCategories: category ? [new Types.ObjectId(category)] : [],
        region: region || null,
        track: track || null,
      },
    });

    const setupToken = crypto.randomBytes(32).toString('hex');
    await this.passwordResetModel.create({
      userId: fellow._id,
      email,
      token: crypto.createHash('sha256').update(setupToken).digest('hex'),
    });

    await this.logActivity(
      ActivityType.STUDENT_CREATED,
      `Fellow ${firstName || ''} ${lastName || ''} (${email}) created by admin`,
      undefined,
      fellow._id.toString(),
      undefined,
      { email, track, region },
      'UserPlus',
    );

    let emailSent = false;
    if (sendEmail) {
      try {
        await this.emailService.sendFellowInvitationEmail(
          email,
          firstName || 'Fellow',
          temporaryPassword,
          { track, cohort: fellow.fellowData.cohort },
        );
        await this.userModel.findByIdAndUpdate(fellow._id, {
          invitationEmailSent: true,
          invitationEmailSentAt: new Date(),
        });
        emailSent = true;
      } catch (err) {
        console.error('Failed to send invitation email:', err);
      }
    }

    return {
      message: 'Fellow created successfully.',
      fellow: {
        _id: fellow._id,
        firstName: fellow.firstName,
        lastName: fellow.lastName,
        email: fellow.email,
        invitationEmailSent: emailSent,
      },
      temporaryPassword,
    };
  }

  async bulkCreateFellows(fellowsData: any[], sendEmails = false) {
    const results = {
      created: 0,
      failed: 0,
      errors: [] as any[],
      fellows: [] as any[],
    };

    for (const dto of fellowsData) {
      if (!dto.email) {
        results.failed++;
        results.errors.push({
          email: dto.email || '(missing)',
          error: 'Email is required',
        });
        continue;
      }
      try {
        const existing = await this.userModel.findOne({ email: dto.email });
        if (existing) {
          results.failed++;
          results.errors.push({
            email: dto.email,
            error: 'Email already exists',
          });
          continue;
        }

        const temporaryPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

        const fellow = await this.userModel.create({
          fullName:
            dto.fullName ||
            `${dto.firstName || ''} ${dto.lastName || ''}`.trim(),
          firstName: dto.firstName || '',
          lastName: dto.lastName || '',
          email: dto.email,
          gender: dto.gender || null,
          country: dto.country || null,
          phoneNumber: dto.phoneNumber || null,
          password: hashedPassword,
          role: UserRole.STUDENT,
          userType: 'fellow',
          isActive: true,
          mustSetPassword: true,
          invitationEmailSent: false,
          fellowData: {
            fellowId: `FELLOW-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
            cohort: new Date().getFullYear().toString(),
            deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            requiredCourses: [],
            fellowshipStatus: FellowshipStatus.ACTIVE,
            assignedCategories: dto.category
              ? [new Types.ObjectId(dto.category)]
              : [],
            region: dto.region || null,
            track: dto.track || null,
          },
        });

        await this.passwordResetModel.create({
          userId: fellow._id,
          email: dto.email,
          token: crypto
            .createHash('sha256')
            .update(crypto.randomBytes(32).toString('hex'))
            .digest('hex'),
        });

        let emailSent = false;
        if (sendEmails) {
          try {
            await this.emailService.sendFellowInvitationEmail(
              dto.email,
              dto.firstName || 'Fellow',
              temporaryPassword,
              { track: dto.track, cohort: fellow.fellowData.cohort },
            );
            await this.userModel.findByIdAndUpdate(fellow._id, {
              invitationEmailSent: true,
              invitationEmailSentAt: new Date(),
            });
            emailSent = true;
          } catch (err) {
            console.error(`Failed to send invitation to ${dto.email}:`, err);
          }
        }

        results.created++;
        results.fellows.push({
          _id: fellow._id,
          firstName: fellow.firstName,
          lastName: fellow.lastName,
          email: fellow.email,
          invitationEmailSent: emailSent,
          // Only expose temporaryPassword when email was not sent (admin may need to share manually)
          temporaryPassword: emailSent ? undefined : temporaryPassword,
        });
      } catch (err: any) {
        results.failed++;
        results.errors.push({ email: dto.email, error: err.message });
      }
    }

    return {
      message: `Bulk creation complete. ${results.created} created, ${results.failed} failed.`,
      ...results,
    };
  }

  async updateFellow(id: string, updateData: any) {
    const allowed = [
      'fullName',
      'firstName',
      'lastName',
      'gender',
      'country',
      'phoneNumber',
      'isActive',
    ];
    const fellowAllowed = ['region', 'track'];
    const userUpdate: any = {};
    const fellowUpdate: any = {};

    for (const f of allowed) {
      if (f in updateData) userUpdate[f] = updateData[f];
    }
    for (const f of fellowAllowed) {
      if (f in updateData) fellowUpdate[`fellowData.${f}`] = updateData[f];
    }

    const fellow = await this.userModel
      .findByIdAndUpdate(id, { ...userUpdate, ...fellowUpdate }, { new: true })
      .select('-password');
    if (!fellow) throw new NotFoundException('Fellow not found');
    return { message: 'Fellow updated', fellow };
  }

  async deleteFellow(id: string) {
    const fellow = await this.userModel.findByIdAndDelete(id);
    if (!fellow) throw new NotFoundException('Fellow not found');
    return { message: 'Fellow deleted' };
  }

  async sendBulkEmailToFellows(
    fellowIds: string[],
    subject: string,
    message: string,
    cc?: string[],
    bcc?: string[],
  ) {
    const fellows = await this.userModel
      .find({ _id: { $in: fellowIds } })
      .select('email firstName lastName invitationEmailSent');
    const results = { sent: 0, failed: 0, details: [] as any[] };

    for (const fellow of fellows) {
      const result = await this.emailService.sendCustomEmail(
        fellow.email,
        subject,
        message,
        { cc, bcc },
      );
      if (result.success) {
        results.sent++;
        results.details.push({ email: fellow.email, status: 'sent' });
      } else {
        results.failed++;
        results.details.push({
          email: fellow.email,
          status: 'failed',
          error: (result as any).error,
        });
      }
    }

    return {
      message: `Bulk email complete. ${results.sent} sent, ${results.failed} failed.`,
      ...results,
    };
  }

  async sendFellowInvitations(fellowIds: string[]) {
    const fellows = await this.userModel
      .find({ _id: { $in: fellowIds } })
      .select('email firstName fellowData invitationEmailSent');
    const results = { sent: 0, failed: 0, details: [] as any[] };

    for (const fellow of fellows) {
      const temporaryPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
      await this.userModel.findByIdAndUpdate(fellow._id, {
        password: hashedPassword,
        mustSetPassword: true,
      });

      const result = await this.emailService.sendFellowInvitationEmail(
        fellow.email,
        fellow.firstName || 'Fellow',
        temporaryPassword,
        {
          track: (fellow.fellowData as any)?.track,
          cohort: fellow.fellowData?.cohort,
        },
      );

      if (result.success) {
        results.sent++;
        await this.userModel.findByIdAndUpdate(fellow._id, {
          invitationEmailSent: true,
          invitationEmailSentAt: new Date(),
        });
        results.details.push({ email: fellow.email, status: 'sent' });
      } else {
        results.failed++;
        results.details.push({
          email: fellow.email,
          status: 'failed',
          error: result.message,
        });
      }
    }

    return {
      message: `Invitations sent. ${results.sent} succeeded, ${results.failed} failed.`,
      ...results,
    };
  }

  // Fellows Management
  async getAllFellows(
    filters: {
      status?: string;
      page?: number;
      limit?: number;
      search?: string;
    } = {},
  ) {
    const { status, page = 1, limit = 50, search } = filters;
    const query: any = { 'fellowData.fellowId': { $exists: true } };

    if (status && status !== 'all') {
      query['fellowData.fellowshipStatus'] = status;
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'fellowData.track': { $regex: search, $options: 'i' } },
        { 'fellowData.region': { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [fellows, total] = await Promise.all([
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
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    const fellows = await this.userModel
      .find({
        'fellowData.fellowshipStatus': FellowshipStatus.ACTIVE,
        'fellowData.deadline': { $lte: thirtyDaysFromNow },
      })
      .select('-password')
      .sort({ 'fellowData.deadline': 1 })
      .lean();

    // Calculate progress for each fellow
    const fellowsAtRisk = fellows
      .map((fellow) => {
        const daysLeft = Math.ceil(
          (fellow.fellowData.deadline.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        // Mock progress - calculate based on actual course completions in production
        const progress = Math.floor(Math.random() * 50);

        return {
          ...fellow,
          daysLeft,
          progress,
          isAtRisk: daysLeft < 30 && progress < 50,
        };
      })
      .filter((f) => f.isAtRisk);

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

    if (!message || message.trim().length === 0) {
      throw new BadRequestException('Reminder message is required');
    }

    const subject = 'Reminder from Arin Academy';
    const personalised = `Dear ${fellow.firstName || 'Fellow'},\n\n${message.trim()}`;

    const result = await this.emailService.sendCustomEmail(
      fellow.email,
      subject,
      personalised,
    );

    if (!result.success) {
      throw new BadRequestException('Failed to send reminder email');
    }

    return {
      message: 'Reminder sent successfully',
      sentTo: fellow.email,
    };
  }

  async assignFellowCategories(
    userId: string,
    categories: string[],
    adminId: string,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Initialize fellowData if it doesn't exist
    if (!user.fellowData) {
      user.fellowData = { fellowId: new Date().toISOString() } as any;
    }

    // Update assigned categories
    user.fellowData['assignedCategories'] = categories.map(
      (id: string) => new Types.ObjectId(id),
    );
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
    const updatedCourse = await this.courseModel
      .findByIdAndUpdate(
        courseId,
        {
          status: 'approved',
          approvedBy: adminId,
          approvedAt: new Date(),
        },
        { new: true },
      )
      .populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    const instructors = Array.isArray(updatedCourse.instructorIds)
      ? updatedCourse.instructorIds
      : [];

    // Log the activity
    const instructorNames = instructors
      .filter((i) => i && typeof i === 'object' && 'firstName' in i)
      .map((i) => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
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
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor &&
          'firstName' in instructor
        ) {
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
      if (
        mainInstructor &&
        typeof mainInstructor === 'object' &&
        'firstName' in mainInstructor &&
        'lastName' in mainInstructor &&
        'email' in mainInstructor
      ) {
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
    const updatedCourse = await this.courseModel
      .findByIdAndUpdate(
        courseId,
        {
          status: 'rejected',
          rejectionReason: reason,
        },
        { new: true },
      )
      .populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    const instructors = Array.isArray(updatedCourse.instructorIds)
      ? updatedCourse.instructorIds
      : [];

    // Log the activity
    const instructorNames = instructors
      .filter((i) => i && typeof i === 'object' && 'firstName' in i)
      .map((i) => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
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
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor &&
          'firstName' in instructor
        ) {
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
      if (
        mainInstructor &&
        typeof mainInstructor === 'object' &&
        'firstName' in mainInstructor &&
        'lastName' in mainInstructor &&
        'email' in mainInstructor
      ) {
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
    const course = await this.courseModel
      .findById(courseId)
      .populate('instructorIds');

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.status !== 'submitted') {
      throw new BadRequestException('Only submitted courses can be approved');
    }

    const updatedCourse = await this.courseModel
      .findByIdAndUpdate(
        courseId,
        {
          status: 'published', // Automatically publish course when approved
          approvedBy: adminId,
          approvedAt: new Date(),
          publishedAt: new Date(),
        },
        { new: true },
      )
      .populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    // Log the activity
    const instructors = Array.isArray(updatedCourse.instructorIds)
      ? updatedCourse.instructorIds
      : [];
    const instructorNames = instructors
      .filter((i) => i && typeof i === 'object' && 'firstName' in i)
      .map((i) => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
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
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor &&
          'firstName' in instructor &&
          'lastName' in instructor
        ) {
          await this.emailService.sendCourseApprovedEmail(
            String(instructor.email),
            `${instructor.firstName} ${instructor.lastName}`,
            updatedCourse.title,
          );
        }
      }
    } catch (error) {
      console.error(
        'Failed to send course approval email to instructor(s):',
        error,
      );
      // Don't fail the approval if email fails
    }

    return {
      message: 'Course approved successfully',
      course: updatedCourse,
    };
  }

  async rejectPendingCourse(
    courseId: string,
    reason: string,
    adminId?: string,
  ) {
    const course = await this.courseModel
      .findById(courseId)
      .populate('instructorIds');

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.status !== 'submitted') {
      throw new BadRequestException('Only submitted courses can be rejected');
    }

    const updatedCourse = await this.courseModel
      .findByIdAndUpdate(
        courseId,
        {
          status: 'rejected',
          rejectionReason: reason,
          rejectedAt: new Date(),
        },
        { new: true },
      )
      .populate('instructorIds');

    if (!updatedCourse) {
      throw new NotFoundException('Course not found');
    }

    // Log the activity
    const instructors = Array.isArray(updatedCourse.instructorIds)
      ? updatedCourse.instructorIds
      : [];
    const instructorNames = instructors
      .filter((i) => i && typeof i === 'object' && 'firstName' in i)
      .map((i) => `${(i as any).firstName} ${(i as any).lastName || ''}`.trim())
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
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor &&
          'firstName' in instructor &&
          'lastName' in instructor
        ) {
          await this.emailService.sendCourseRejectedEmail(
            String(instructor.email),
            `${instructor.firstName} ${instructor.lastName}`,
            updatedCourse.title,
            reason,
          );
        }
      }
    } catch (error) {
      console.error(
        'Failed to send course rejection email to instructor(s):',
        error,
      );
      // Don't block the rejection if email fails
    }

    return {
      message: 'Course rejected successfully',
      course: updatedCourse,
    };
  }

  async getAllCourses(
    filters: { status?: string; page?: number; limit?: number } = {},
  ) {
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
                ...(module.toObject ? module.toObject() : module),
                lessons: [], // Add empty lessons array
              };
            }
            return module;
          });

          if (needsUpdate) {
            await this.courseModel.findByIdAndUpdate(
              course._id,
              { modules: updatedModules },
              { new: true },
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
    const course = await this.courseModel
      .findById(courseId)
      .populate('instructorIds');

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Delete the course
    await this.courseModel.findByIdAndDelete(courseId);

    // Send deletion notification email to instructor
    try {
      const instructors = Array.isArray(course.instructorIds)
        ? course.instructorIds
        : [];
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const dashboardUrl = `${frontendUrl}/instructor/dashboard`;

      for (const instructor of instructors) {
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor &&
          'firstName' in instructor &&
          'lastName' in instructor
        ) {
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
            htmlContent,
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
  async getStudentsNotFinished(
    filters: { page?: number; limit?: number } = {},
  ) {
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
      students: enrollments.map((e) => ({
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

    const customMessage =
      message ||
      `We noticed you haven't finished "${course.title}" yet. Continue your learning journey and complete the course to earn your certificate!`;

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

  async sendRemindersToMultipleStudents(
    enrollmentIds: string[],
    message?: string,
  ) {
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
      enrollments.map((e) => e._id),
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
        lastAccessedAt: { $gte: thirtyDaysAgo },
      }),
      this.courseModel.countDocuments(),
      this.courseModel.countDocuments({ status: CourseStatus.PUBLISHED }),
      this.userModel.countDocuments({ role: UserRole.STUDENT }),
      this.userModel.countDocuments({
        role: UserRole.INSTRUCTOR,
        instructorStatus: InstructorStatus.APPROVED,
      }),
    ]);

    const completionRate =
      totalEnrollments > 0
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

  async getStudentProgressAnalytics(
    limit = 50,
    status: 'in-progress' | 'completed' | 'all' = 'all',
  ) {
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

    const students = progressData.map((enrollment) => ({
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
      daysEnrolled: Math.floor(
        (new Date().getTime() - new Date(enrollment.enrolledAt).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    }));

    const avgProgress =
      students.length > 0
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

        const totalStudents = courses.reduce(
          (sum, course) => sum + (course.enrollmentCount || 0),
          0,
        );

        return {
          instructorId: instructor._id,
          name: `${instructor.firstName} ${instructor.lastName}`,
          email: instructor.email,
          status: instructor.instructorStatus,
          coursesCreated: courses.length,
          publishedCourses: courses.filter(
            (c) => c.status === CourseStatus.PUBLISHED || !!c.publishedAt,
          ).length,
          pendingApproval: courses.filter(
            (c) => c.status === CourseStatus.SUBMITTED,
          ).length,
          totalStudents,
          lastLogin: instructor.lastLogin,
          joinedAt: instructor.createdAt,
        };
      }),
    );

    return {
      instructors: instructorActivity,
      summary: {
        total: instructors.length,
        approved: instructors.filter(
          (i) => i.instructorStatus === InstructorStatus.APPROVED,
        ).length,
        pending: instructors.filter(
          (i) => i.instructorStatus === InstructorStatus.PENDING,
        ).length,
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
            $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] },
          },
          avgProgress: { $avg: '$progress' },
        },
      },
      {
        $lookup: {
          from: 'courses',
          localField: '_id',
          foreignField: '_id',
          as: 'course',
        },
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
              100,
            ],
          },
          avgProgress: { $round: ['$avgProgress', 1] },
        },
      },
      { $sort: { completionRate: -1 } },
    ]);

    const overallStats = await Enrollment.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] },
          },
          avgProgress: { $avg: '$progress' },
        },
      },
    ]);

    const overall = overallStats[0] || {
      total: 0,
      completed: 0,
      avgProgress: 0,
    };
    const overallCompletionRate =
      overall.total > 0
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
    const courseIds = courses.map((c) => c._id);

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
      performedBy: log.performedBy
        ? {
            _id: log.performedBy?._id || null,
            name:
              log.performedBy?.firstName && log.performedBy?.lastName
                ? `${log.performedBy.firstName} ${log.performedBy.lastName}`
                : 'Unknown',
            email: log.performedBy?.email || null,
            role: log.performedBy?.role || null,
          }
        : null,
      targetUser: log.targetUser
        ? {
            _id: log.targetUser?._id || null,
            name:
              log.targetUser?.firstName && log.targetUser?.lastName
                ? `${log.targetUser.firstName} ${log.targetUser.lastName}`
                : 'Unknown',
            email: log.targetUser?.email || null,
            role: log.targetUser?.role || null,
          }
        : null,
      targetCourse: log.targetCourse
        ? {
            _id: log.targetCourse?._id || null,
            title: log.targetCourse?.title || 'Unknown',
          }
        : null,
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
      const fileExtension = path
        .extname(file.originalname)
        .toLowerCase()
        .replace('.', '');

      if (!allowedExtensions.includes(fileExtension)) {
        throw new BadRequestException('Only PDF and DOC files are allowed');
      }

      // Create uploads directory if it doesn't exist
      const courseFormatsDir = path.join(
        process.cwd(),
        'uploads',
        'course-formats',
      );
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
      const existingFormat = await this.courseFormatModel.findOne({
        isActive: true,
      });
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
      throw new BadRequestException(
        error.message || 'Failed to upload course format',
      );
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
      throw new BadRequestException(
        error.message || 'Failed to fetch course format',
      );
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
      throw new BadRequestException(
        error.message || 'Failed to delete course format',
      );
    }
  }

  // ===================== MODULE MANAGEMENT =====================

  async getAllModules(
    filters: {
      status?: string;
      level?: string;
      category?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { status, level, category, page = 1, limit = 20 } = filters;
    const query: any = { isActive: { $ne: false } };

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
    const query: any = {
      status: ModuleStatus.SUBMITTED,
      isActive: { $ne: false },
    };
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
          completedCount: {
            $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] },
          },
          avgProgress: { $avg: '$overallProgress' },
        },
      },
    ]);

    const stats = enrollmentStats[0] || {
      totalEnrollments: 0,
      completedCount: 0,
      avgProgress: 0,
    };

    return {
      ...moduleDoc,
      enrollmentStats: {
        totalEnrollments: stats.totalEnrollments,
        completedCount: stats.completedCount,
        completionRate:
          stats.totalEnrollments > 0
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

    if (
      moduleDoc.status === ModuleStatus.PUBLISHED ||
      moduleDoc.status === ModuleStatus.ARCHIVED
    ) {
      throw new BadRequestException('Module is already published or archived');
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
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor
        ) {
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
        if (
          instructor &&
          typeof instructor === 'object' &&
          'email' in instructor
        ) {
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

  // ── Admin: Create module on behalf of an instructor ───────────────────────
  async createModuleAsAdmin(
    adminId: string,
    createModuleDto: CreateModuleDto,
  ): Promise<ModuleEntity> {
    const {
      assignedInstructorId,
      pendingInstructorEmail,
      pendingInstructorName,
      ...rest
    } = createModuleDto;

    const category = await this.categoryModel.findById(rest.categoryId);
    if (!category) throw new NotFoundException('Category not found');

    let instructorIds: Types.ObjectId[] = [];

    if (assignedInstructorId) {
      const instructor = await this.userModel.findById(assignedInstructorId);
      if (!instructor)
        throw new NotFoundException('Assigned instructor not found');
      instructorIds = [new Types.ObjectId(assignedInstructorId)];
    }

    const module = new this.moduleModel({
      ...rest,
      categoryId: new Types.ObjectId(rest.categoryId),
      instructorIds,
      ...(pendingInstructorEmail && !assignedInstructorId
        ? { pendingInstructorEmail, pendingInstructorName }
        : {}),
      createdBy: new Types.ObjectId(adminId),
      createdByRole: 'admin',
      status: ModuleStatus.PUBLISHED,
      publishedAt: new Date(),
    });

    const saved = await module.save();

    await this.logActivity(
      ActivityType.COURSE_CREATED,
      `Admin created module "${saved.title}" ${assignedInstructorId ? 'for instructor' : pendingInstructorEmail ? `for pending instructor ${pendingInstructorEmail}` : '(unassigned)'}`,
      adminId,
      assignedInstructorId,
      undefined,
      { moduleId: saved._id, moduleTitle: saved.title },
      'BookOpen',
    );

    return saved;
  }

  // ── Update a module (admin can edit any module regardless of status/owner) ──
  async updateModuleAsAdmin(
    moduleId: string,
    adminId: string,
    dto: UpdateModuleDto,
  ): Promise<ModuleEntity> {
    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');

    Object.assign(moduleDoc, dto, {
      lastEditedBy: new Types.ObjectId(adminId),
      lastEditedAt: new Date(),
    });

    const saved = await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_CREATED,
      `Admin updated module "${saved.title}"`,
      adminId,
      undefined,
      undefined,
      { moduleId: saved._id, moduleTitle: saved.title },
      'Edit',
    );

    return saved;
  }

  // ── Add a lesson to any module (admin, bypasses ownership check) ──────────
  async addModuleLessonAsAdmin(
    moduleId: string,
    adminId: string,
    lessonData: any,
  ): Promise<ModuleEntity> {
    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');

    const lesson: any = {
      ...lessonData,
      order: lessonData.order ?? moduleDoc.lessons.length,
      slides: (lessonData.slides || []).map((s: any, i: number) => ({
        ...s,
        order: s.order ?? i,
        minViewingTime: s.minViewingTime ?? 15,
        scrollTrackingEnabled: s.scrollTrackingEnabled ?? false,
      })),
    };

    moduleDoc.lessons.push(lesson);
    moduleDoc.lastEditedBy = new Types.ObjectId(adminId);
    moduleDoc.lastEditedAt = new Date();

    return await moduleDoc.save();
  }

  // ── Delete a lesson from any module (admin, bypasses ownership check) ─────
  async deleteModuleLessonAsAdmin(
    moduleId: string,
    lessonIndex: number,
    adminId: string,
  ): Promise<ModuleEntity> {
    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');

    if (lessonIndex >= moduleDoc.lessons.length)
      throw new NotFoundException('Lesson not found');

    moduleDoc.lessons.splice(lessonIndex, 1);
    moduleDoc.lessons.forEach((l: any, i: number) => {
      l.order = i;
    });
    moduleDoc.lastEditedBy = new Types.ObjectId(adminId);
    moduleDoc.lastEditedAt = new Date();

    return await moduleDoc.save();
  }

  // ── Delete a module (admin can remove any module regardless of status) ────
  async deleteModuleAsAdmin(moduleId: string, adminId: string): Promise<void> {
    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');

    moduleDoc.isActive = false;
    await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_CREATED,
      `Admin removed module "${moduleDoc.title}"`,
      adminId,
      undefined,
      undefined,
      { moduleId: moduleDoc._id, moduleTitle: moduleDoc.title },
      'Trash2',
    );
  }

  // ── Link pending modules to a newly approved instructor ──────────────────
  private async linkPendingModules(
    instructorId: string,
    instructorEmail: string,
  ) {
    try {
      await this.moduleModel.updateMany(
        { pendingInstructorEmail: instructorEmail },
        {
          $push: { instructorIds: new Types.ObjectId(instructorId) },
          $unset: { pendingInstructorEmail: '', pendingInstructorName: '' },
        },
      );
    } catch (err) {
      console.error('Failed to link pending modules for instructor:', err);
    }
  }

  // ── Approve assessment update ─────────────────────────────────────────────
  async approveAssessment(moduleId: string, adminId?: string) {
    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');

    if (moduleDoc.assessmentReviewStatus !== AssessmentReviewStatus.PENDING) {
      throw new BadRequestException('No pending assessment update to approve');
    }

    moduleDoc.assessmentReviewStatus = AssessmentReviewStatus.APPROVED;
    moduleDoc.assessmentRejectionReason = undefined;
    await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_CREATED,
      `Assessment for module "${moduleDoc.title}" has been approved`,
      adminId,
      undefined,
      undefined,
      { moduleId, moduleTitle: moduleDoc.title },
      'CheckCircle',
    );

    return { message: 'Assessment approved', module: moduleDoc };
  }

  // ── Reject assessment update ──────────────────────────────────────────────
  async rejectAssessment(moduleId: string, reason: string, adminId?: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');

    if (moduleDoc.assessmentReviewStatus !== AssessmentReviewStatus.PENDING) {
      throw new BadRequestException('No pending assessment update to reject');
    }

    moduleDoc.assessmentReviewStatus = AssessmentReviewStatus.REJECTED;
    moduleDoc.assessmentRejectionReason = reason;
    await moduleDoc.save();

    await this.logActivity(
      ActivityType.COURSE_REJECTED,
      `Assessment for module "${moduleDoc.title}" has been rejected`,
      adminId,
      undefined,
      undefined,
      { moduleId, moduleTitle: moduleDoc.title, reason },
      'XCircle',
    );

    return { message: 'Assessment rejected', module: moduleDoc };
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
      this.moduleModel.countDocuments({ isActive: { $ne: false } }),
      this.moduleModel.countDocuments({
        status: ModuleStatus.DRAFT,
        isActive: { $ne: false },
      }),
      this.moduleModel.countDocuments({
        status: ModuleStatus.SUBMITTED,
        isActive: { $ne: false },
      }),
      this.moduleModel.countDocuments({
        status: ModuleStatus.APPROVED,
        isActive: { $ne: false },
      }),
      this.moduleModel.countDocuments({
        status: ModuleStatus.PUBLISHED,
        isActive: { $ne: false },
      }),
      this.moduleModel.countDocuments({
        status: ModuleStatus.REJECTED,
        isActive: { $ne: false },
      }),
      this.moduleEnrollmentModel.countDocuments(),
      this.moduleEnrollmentModel.countDocuments({ isCompleted: true }),
    ]);

    const moduleCompletionRate =
      totalModuleEnrollments > 0
        ? ((completedModuleEnrollments / totalModuleEnrollments) * 100).toFixed(
            1,
          )
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

  // ─────────────────────────────────────────────────────────────────────────────
  // FELLOW PROGRESS TRACKING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Classify a fellow's risk level based on progress vs. deadline pace.
   *   COMPLETED  – fellowship status is completed
   *   ON_TRACK   – progress >= expected pace (or no deadline set)
   *   AT_RISK    – progress 10-20 pp below pace, or < 50% with < 30 days left
   *   CRITICAL   – < 30 days left AND < 30% done, or > 20 pp behind pace
   *   INACTIVE   – no module access in 14+ days
   */
  private classifyRisk(
    progressPct: number,
    daysLeft: number | null,
    totalDays: number | null,
    lastAccessedAt: Date | null,
    fellowshipStatus: string,
  ): 'COMPLETED' | 'ON_TRACK' | 'AT_RISK' | 'CRITICAL' | 'INACTIVE' {
    if (fellowshipStatus === FellowshipStatus.COMPLETED) return 'COMPLETED';

    const daysSinceAccess = lastAccessedAt
      ? Math.floor((Date.now() - lastAccessedAt.getTime()) / 86400000)
      : 99999;

    if (daysSinceAccess >= 14 && progressPct < 100) return 'INACTIVE';

    if (daysLeft !== null && totalDays !== null && totalDays > 0) {
      const elapsed = totalDays - daysLeft;
      const expectedPace = totalDays > 0 ? (elapsed / totalDays) * 100 : 0;
      const gap = expectedPace - progressPct;

      if (daysLeft < 14 && progressPct < 30) return 'CRITICAL';
      if (daysLeft < 30 && progressPct < 50) return 'CRITICAL';
      if (gap > 25) return 'CRITICAL';
      if (gap > 10 || (daysLeft < 60 && progressPct < 40)) return 'AT_RISK';
    }

    return 'ON_TRACK';
  }

  /**
   * Compute real progress for one fellow across all their assigned categories.
   * Returns aggregated module stats + per-category breakdown.
   */
  private async computeFellowProgress(fellow: any): Promise<{
    totalModules: number;
    enrolledModules: number;
    completedModules: number;
    inProgressModules: number;
    overallProgressPct: number;
    lastAccessedAt: Date | null;
    categories: Array<{
      categoryId: string;
      categoryName: string;
      totalModules: number;
      completedModules: number;
      progressPct: number;
    }>;
  }> {
    const assignedCategoryIds: Types.ObjectId[] =
      fellow.fellowData?.assignedCategories || [];

    if (assignedCategoryIds.length === 0) {
      return {
        totalModules: 0,
        enrolledModules: 0,
        completedModules: 0,
        inProgressModules: 0,
        overallProgressPct: 0,
        lastAccessedAt: null,
        categories: [],
      };
    }

    // Fetch all modules in assigned categories
    const modules = await this.moduleModel
      .find({ categoryId: { $in: assignedCategoryIds } })
      .select('_id title level categoryId')
      .lean();

    if (modules.length === 0) {
      return {
        totalModules: 0,
        enrolledModules: 0,
        completedModules: 0,
        inProgressModules: 0,
        overallProgressPct: 0,
        lastAccessedAt: null,
        categories: [],
      };
    }

    const moduleIds = modules.map((m) => m._id);

    // Fetch all enrollments for this fellow in those modules
    const enrollments = await this.moduleEnrollmentModel
      .find({
        studentId: new Types.ObjectId(fellow._id.toString()),
        moduleId: { $in: moduleIds },
      })
      .select('moduleId progress isCompleted lastAccessedAt')
      .lean();

    const enrollmentMap = new Map(
      enrollments.map((e) => [(e.moduleId as any).toString(), e]),
    );

    let totalProgress = 0;
    let completedCount = 0;
    let inProgressCount = 0;
    let latestAccess: Date | null = null;

    for (const enr of enrollments) {
      if (enr.isCompleted) completedCount++;
      else if (enr.progress > 0) inProgressCount++;
      totalProgress += enr.progress || 0;
      if (enr.lastAccessedAt) {
        if (!latestAccess || enr.lastAccessedAt > latestAccess) {
          latestAccess = enr.lastAccessedAt;
        }
      }
    }

    const overallProgressPct =
      modules.length > 0
        ? Math.round(
            (completedCount / modules.length) * 100,
          )
        : 0;

    // Category-level breakdown
    const categoryMap = new Map<string, any>();
    for (const cat of assignedCategoryIds) {
      const catId = cat.toString();
      categoryMap.set(catId, {
        categoryId: catId,
        categoryName: '',
        totalModules: 0,
        completedModules: 0,
        progressPct: 0,
      });
    }

    for (const mod of modules) {
      const catId = (mod.categoryId as any).toString();
      const entry = categoryMap.get(catId);
      if (!entry) continue;
      entry.totalModules++;
      const enr = enrollmentMap.get((mod._id as any).toString());
      if (enr?.isCompleted) entry.completedModules++;
    }

    // Resolve category names
    const categories = await this.categoryModel
      .find({ _id: { $in: assignedCategoryIds } })
      .select('_id name')
      .lean();

    for (const cat of categories) {
      const entry = categoryMap.get((cat._id as any).toString());
      if (entry) {
        entry.categoryName = (cat as any).name;
        entry.progressPct =
          entry.totalModules > 0
            ? Math.round((entry.completedModules / entry.totalModules) * 100)
            : 0;
      }
    }

    return {
      totalModules: modules.length,
      enrolledModules: enrollments.length,
      completedModules: completedCount,
      inProgressModules: inProgressCount,
      overallProgressPct,
      lastAccessedAt: latestAccess,
      categories: Array.from(categoryMap.values()),
    };
  }

  /**
   * GET /admin/fellows/progress — list all fellows with real progress data.
   * Supports filters: status, category, cohort, risk, search, page, limit.
   */
  async getFellowsProgress(filters: {
    status?: string;
    categoryId?: string;
    cohort?: string;
    risk?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { status, categoryId, cohort, risk, search, page = 1, limit = 30 } = filters;

    const query: any = { 'fellowData.fellowId': { $exists: true } };

    if (status && status !== 'all') {
      query['fellowData.fellowshipStatus'] = status;
    }
    if (cohort) {
      query['fellowData.cohort'] = cohort;
    }
    if (categoryId) {
      query['fellowData.assignedCategories'] = new Types.ObjectId(categoryId);
    }
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'fellowData.track': { $regex: search, $options: 'i' } },
        { 'fellowData.cohort': { $regex: search, $options: 'i' } },
      ];
    }

    const fellows = await this.userModel
      .find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    const now = Date.now();

    // Compute progress for each fellow (parallelised)
    const withProgress = await Promise.all(
      fellows.map(async (fellow) => {
        const progress = await this.computeFellowProgress(fellow);

        const deadline = fellow.fellowData?.deadline
          ? new Date(fellow.fellowData.deadline)
          : null;
        const createdAt = new Date((fellow as any).createdAt || Date.now());

        const daysLeft = deadline
          ? Math.ceil((deadline.getTime() - now) / 86400000)
          : null;
        const totalDays = deadline
          ? Math.ceil((deadline.getTime() - createdAt.getTime()) / 86400000)
          : null;

        const riskLevel = this.classifyRisk(
          progress.overallProgressPct,
          daysLeft,
          totalDays,
          progress.lastAccessedAt,
          fellow.fellowData?.fellowshipStatus || '',
        );

        return {
          _id: (fellow._id as any).toString(),
          firstName: fellow.firstName,
          lastName: fellow.lastName,
          email: fellow.email,
          phoneNumber: fellow.phoneNumber,
          isActive: fellow.isActive,
          fellowData: fellow.fellowData,
          daysLeft,
          totalDays,
          riskLevel,
          ...progress,
        };
      }),
    );

    // Apply risk filter (post-aggregation)
    const filtered = risk && risk !== 'all'
      ? withProgress.filter((f) => f.riskLevel === risk.toUpperCase())
      : withProgress;

    // Stats summary
    const stats = {
      total: filtered.length,
      onTrack: filtered.filter((f) => f.riskLevel === 'ON_TRACK').length,
      atRisk: filtered.filter((f) => f.riskLevel === 'AT_RISK').length,
      critical: filtered.filter((f) => f.riskLevel === 'CRITICAL').length,
      inactive: filtered.filter((f) => f.riskLevel === 'INACTIVE').length,
      completed: filtered.filter((f) => f.riskLevel === 'COMPLETED').length,
      avgProgress: filtered.length > 0
        ? Math.round(filtered.reduce((s, f) => s + f.overallProgressPct, 0) / filtered.length)
        : 0,
    };

    // Paginate
    const skip = (page - 1) * limit;
    const paginated = filtered.slice(skip, skip + limit);

    return {
      fellows: paginated,
      stats,
      pagination: {
        page,
        limit,
        total: filtered.length,
        pages: Math.ceil(filtered.length / limit),
      },
    };
  }

  /**
   * GET /admin/fellows/:id/progress — full progress detail for one fellow.
   */
  async getFellowProgressDetail(fellowId: string) {
    const fellow = await this.userModel
      .findOne({
        _id: fellowId,
        'fellowData.fellowId': { $exists: true },
      })
      .select('-password')
      .lean();

    if (!fellow) throw new NotFoundException('Fellow not found');

    const assignedCategoryIds: Types.ObjectId[] =
      fellow.fellowData?.assignedCategories || [];

    // Get all modules in assigned categories
    const modules = await this.moduleModel
      .find({ categoryId: { $in: assignedCategoryIds } })
      .select('_id title level categoryId')
      .lean();

    // Get all enrollments for this fellow
    const enrollments = await this.moduleEnrollmentModel
      .find({
        studentId: new Types.ObjectId(fellowId),
        moduleId: { $in: modules.map((m) => m._id) },
      })
      .select(
        'moduleId progress isCompleted completedAt lastAccessedAt finalAssessmentPassed finalAssessmentScore completedLessons totalLessons',
      )
      .lean();

    const enrollmentMap = new Map(
      enrollments.map((e) => [(e.moduleId as any).toString(), e]),
    );

    // Category names
    const cats = await this.categoryModel
      .find({ _id: { $in: assignedCategoryIds } })
      .select('_id name')
      .lean();
    const catNames = new Map(
      cats.map((c) => [(c._id as any).toString(), (c as any).name]),
    );

    // Group modules by category with enrollment data
    const categoriesMap = new Map<string, any>();
    for (const mod of modules) {
      const catId = (mod.categoryId as any).toString();
      if (!categoriesMap.has(catId)) {
        categoriesMap.set(catId, {
          categoryId: catId,
          categoryName: catNames.get(catId) || 'Unknown',
          modules: [],
        });
      }
      const enr = enrollmentMap.get((mod._id as any).toString());
      categoriesMap.get(catId).modules.push({
        moduleId: (mod._id as any).toString(),
        title: (mod as any).title,
        level: (mod as any).level,
        status: !enr
          ? 'not_started'
          : enr.isCompleted
            ? 'completed'
            : enr.progress > 0
              ? 'in_progress'
              : 'enrolled',
        progress: enr?.progress || 0,
        completedLessons: enr?.completedLessons || 0,
        totalLessons: enr?.totalLessons || 0,
        lastAccessedAt: enr?.lastAccessedAt || null,
        completedAt: enr?.completedAt || null,
        assessmentPassed: enr?.finalAssessmentPassed || false,
        assessmentScore: enr?.finalAssessmentScore || null,
      });
    }

    const categoriesWithProgress = Array.from(categoriesMap.values()).map(
      (cat) => ({
        ...cat,
        totalModules: cat.modules.length,
        completedModules: cat.modules.filter(
          (m: any) => m.status === 'completed',
        ).length,
        progressPct:
          cat.modules.length > 0
            ? Math.round(
                (cat.modules.filter((m: any) => m.status === 'completed')
                  .length /
                  cat.modules.length) *
                  100,
              )
            : 0,
      }),
    );

    const totalModules = modules.length;
    const completedModules = enrollments.filter((e) => e.isCompleted).length;
    const overallProgressPct =
      totalModules > 0
        ? Math.round((completedModules / totalModules) * 100)
        : 0;

    const latestAccess = enrollments.reduce(
      (latest: Date | null, e) => {
        if (!e.lastAccessedAt) return latest;
        return !latest || e.lastAccessedAt > latest ? e.lastAccessedAt : latest;
      },
      null as Date | null,
    );

    const now = Date.now();
    const deadline = fellow.fellowData?.deadline
      ? new Date(fellow.fellowData.deadline)
      : null;
    const daysLeft = deadline
      ? Math.ceil((deadline.getTime() - now) / 86400000)
      : null;
    const totalDays = deadline
      ? Math.ceil(
          (deadline.getTime() -
            new Date((fellow as any).createdAt || now).getTime()) /
            86400000,
        )
      : null;

    const riskLevel = this.classifyRisk(
      overallProgressPct,
      daysLeft,
      totalDays,
      latestAccess,
      fellow.fellowData?.fellowshipStatus || '',
    );

    return {
      fellow: {
        _id: (fellow._id as any).toString(),
        firstName: fellow.firstName,
        lastName: fellow.lastName,
        email: fellow.email,
        phoneNumber: fellow.phoneNumber,
        isActive: fellow.isActive,
        fellowData: fellow.fellowData,
      },
      totalModules,
      completedModules,
      inProgressModules: enrollments.filter(
        (e) => !e.isCompleted && e.progress > 0,
      ).length,
      notStartedModules: totalModules - enrollments.length,
      overallProgressPct,
      lastAccessedAt: latestAccess,
      daysLeft,
      totalDays,
      riskLevel,
      categories: categoriesWithProgress,
    };
  }

  /**
   * PUT /admin/fellows/:id/progress-action
   * Admin actions: allow_proceed | deactivate | mark_completed
   */
  async updateFellowProgressAction(
    adminId: string,
    fellowId: string,
    action: 'allow_proceed' | 'deactivate' | 'mark_completed',
    note?: string,
  ) {
    const fellow = await this.userModel.findOne({
      _id: fellowId,
      'fellowData.fellowId': { $exists: true },
    });
    if (!fellow) throw new NotFoundException('Fellow not found');

    let updateFields: any = {};
    let activityMessage = '';
    let emailSubject = '';
    let emailBody = '';

    const name = `${fellow.firstName} ${fellow.lastName}`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    switch (action) {
      case 'allow_proceed':
        updateFields = { isActive: true };
        activityMessage = `Fellow ${name} marked as eligible to proceed`;
        emailSubject = 'You are eligible to proceed — ARIN Fellowship';
        emailBody = `Dear ${fellow.firstName},\n\nGreat news! The admin has reviewed your progress and confirmed you are eligible to continue to the next stage of your fellowship.\n\n${note ? `Note from admin: ${note}\n\n` : ''}Keep up the excellent work!\n\nARIN eLearning Team`;
        break;
      case 'deactivate':
        updateFields = { isActive: false };
        activityMessage = `Fellow ${name} deactivated due to insufficient progress`;
        emailSubject = 'Fellowship Status Update — ARIN Academy';
        emailBody = `Dear ${fellow.firstName},\n\nAfter reviewing your progress, we regret to inform you that your access to the fellowship programme has been deactivated.\n\n${note ? `Reason: ${note}\n\n` : ''}If you believe this is an error or would like to discuss this decision, please contact us.\n\nARIN eLearning Team`;
        break;
      case 'mark_completed':
        updateFields = {
          'fellowData.fellowshipStatus': FellowshipStatus.COMPLETED,
        };
        activityMessage = `Fellow ${name} marked as completed`;
        emailSubject = 'Congratulations — Fellowship Completed!';
        emailBody = `Dear ${fellow.firstName},\n\nCongratulations! You have successfully completed the ARIN Fellowship programme.\n\n${note ? `Message from admin: ${note}\n\n` : ''}We are proud of your achievement and look forward to seeing your continued growth.\n\nARIN eLearning Team`;
        break;
    }

    await this.userModel.findByIdAndUpdate(fellowId, { $set: updateFields });

    // Log the action
    await this.logActivity(
      ActivityType.USER_UPDATED,
      activityMessage,
      adminId,
      fellowId,
      undefined,
      { action, note },
      'Activity',
    );

    // Send notification email
    if (fellow.email) {
      await this.emailService.sendCustomEmail(
        fellow.email,
        emailSubject,
        emailBody,
      ).catch((e) =>
        console.error('Failed to send progress-action email:', e),
      );
    }

    return { message: activityMessage };
  }

  /**
   * GET /admin/fellows/progress/stats — aggregate overview stats for the progress dashboard.
   */
  async getFellowProgressStats() {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 86400000);
    const thirtyDaysFromNow = new Date(now + 30 * 86400000);

    const [totalFellows, activeFellows, completedFellows, expiredFellows] =
      await Promise.all([
        this.userModel.countDocuments({ 'fellowData.fellowId': { $exists: true } }),
        this.userModel.countDocuments({ 'fellowData.fellowshipStatus': FellowshipStatus.ACTIVE }),
        this.userModel.countDocuments({ 'fellowData.fellowshipStatus': FellowshipStatus.COMPLETED }),
        this.userModel.countDocuments({ 'fellowData.fellowshipStatus': FellowshipStatus.EXPIRED }),
      ]);

    // Fellows approaching deadline (within 30 days, still active)
    const approachingDeadline = await this.userModel.countDocuments({
      'fellowData.fellowshipStatus': FellowshipStatus.ACTIVE,
      'fellowData.deadline': { $lte: thirtyDaysFromNow },
    });

    // Module completion stats across all fellows
    const [totalEnrollments, completedEnrollments] = await Promise.all([
      this.moduleEnrollmentModel.countDocuments(),
      this.moduleEnrollmentModel.countDocuments({ isCompleted: true }),
    ]);

    // Recent completions (last 7 days)
    const recentCompletions = await this.moduleEnrollmentModel.countDocuments({
      isCompleted: true,
      completedAt: { $gte: sevenDaysAgo },
    });

    // Inactive fellows (no module access in 14+ days)
    const inactiveEnrollments = await this.moduleEnrollmentModel
      .find({
        isCompleted: false,
        $or: [
          { lastAccessedAt: { $lte: new Date(now - 14 * 86400000) } },
          { lastAccessedAt: null },
        ],
      })
      .distinct('studentId');

    // Cohorts list for filter
    const cohorts = await this.userModel.distinct('fellowData.cohort', {
      'fellowData.fellowId': { $exists: true },
      'fellowData.cohort': { $ne: null },
    });

    return {
      totalFellows,
      activeFellows,
      completedFellows,
      expiredFellows,
      approachingDeadline,
      inactiveFellowsEstimate: inactiveEnrollments.length,
      totalModuleEnrollments: totalEnrollments,
      completedModuleEnrollments: completedEnrollments,
      moduleCompletionRate:
        totalEnrollments > 0
          ? Math.round((completedEnrollments / totalEnrollments) * 100)
          : 0,
      recentCompletions,
      cohorts: cohorts.filter(Boolean),
    };
  }
}
