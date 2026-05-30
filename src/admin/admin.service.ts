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
import { ModuleCertificate } from '../schemas/module-certificate.schema';
import { Category } from '../schemas/category.schema';
import { Microgrant, MicrograntStatus } from '../schemas/microgrant.schema';
import { EmailService } from '../common/services/email.service';
import { EmailQueueService } from '../email-queue/email-queue.service';
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
    @InjectModel(ModuleCertificate.name)
    private moduleCertificateModel: Model<ModuleCertificate>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    @InjectModel(Microgrant.name) private micrograntModel: Model<Microgrant>,
    private emailService: EmailService,
    private emailQueueService: EmailQueueService,
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

    this.emailService
      .sendInstructorApprovalEmail(instructor.email, instructor.firstName, true)
      .catch((e) => console.error('Failed to send instructor approval email:', e.message));

    this.emailService
      .sendInstructorRegistrationNotificationToAdmin(
        'faith.muiruri@strathmore.edu',
        `${instructor.firstName} ${instructor.lastName}`,
        instructor.email,
        instructor.institution || 'Not provided',
        `Status: APPROVED`,
        instructor._id.toString(),
      )
      .catch((e) => console.error('Failed to send admin notification (approve):', e.message));

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

    this.emailService
      .sendInstructorApprovalEmail(instructor.email, instructor.firstName, false)
      .catch((e) => console.error('Failed to send instructor rejection email:', e.message));

    this.emailService
      .sendInstructorRegistrationNotificationToAdmin(
        'faith.muiruri@strathmore.edu',
        `${instructor.firstName} ${instructor.lastName}`,
        instructor.email,
        instructor.institution || 'Not provided',
        `Status: REJECTED - Reason: ${reason}`,
        instructor._id.toString(),
      )
      .catch((e) => console.error('Failed to send admin notification (reject):', e.message));

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

    this.emailService
      .sendStudentRegistrationEmail(email, firstName, temporaryPassword, categoryNames)
      .catch((e) => console.error('Failed to send student registration email:', e.message));

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

    this.emailService
      .sendInstructorRegistrationEmail(email, firstName, temporaryPassword)
      .catch((e) => console.error('Failed to send instructor registration email:', e.message));

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

        this.emailService
          .sendStudentRegistrationEmail(studentData.email, studentData.firstName, temporaryPassword)
          .catch((e) => console.error(`Failed to send email to ${studentData.email}:`, e.message));

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

    // Send email in the background — never block the HTTP response waiting for SMTP
    if (sendEmail) {
      this.emailService
        .sendFellowInvitationEmail(
          email,
          firstName || 'Fellow',
          temporaryPassword,
          { track, cohort: fellow.fellowData.cohort, setupToken },
        )
        .then((result) => {
          if (result?.success) {
            return this.userModel.findByIdAndUpdate(fellow._id, {
              invitationEmailSent: true,
              invitationEmailSentAt: new Date(),
            });
          } else {
            console.error(`Fellow invitation email failed for ${email}:`, result?.message);
          }
        })
        .catch((err) =>
          console.error('Failed to send fellow invitation email:', err.message),
        );
    }

    return {
      message: 'Fellow created successfully.',
      fellow: {
        _id: fellow._id,
        firstName: fellow.firstName,
        lastName: fellow.lastName,
        email: fellow.email,
        invitationEmailSent: sendEmail ?? false,
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
      emailsQueued: 0,
    };

    // Collect jobs to enqueue in a single Redis round-trip after all DB writes
    const emailJobs: Array<{
      userId: string;
      email: string;
      firstName: string;
      temporaryPassword: string;
      track?: string;
      cohort?: string;
      setupToken: string;
    }> = [];

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

        const rawSetupToken = crypto.randomBytes(32).toString('hex');
        await this.passwordResetModel.create({
          userId: fellow._id,
          email: dto.email,
          token: crypto.createHash('sha256').update(rawSetupToken).digest('hex'),
        });

        if (sendEmails) {
          emailJobs.push({
            userId: (fellow._id as any).toString(),
            email: dto.email,
            firstName: dto.firstName || dto.fullName?.split(' ')[0] || 'Fellow',
            temporaryPassword,
            track: dto.track,
            cohort: fellow.fellowData.cohort,
            setupToken: rawSetupToken,
          });
        }

        results.created++;
        results.fellows.push({
          _id: fellow._id,
          firstName: fellow.firstName,
          lastName: fellow.lastName,
          email: fellow.email,
          // Password only exposed when emails are not being sent (admin shares manually)
          temporaryPassword: sendEmails ? undefined : temporaryPassword,
        });
      } catch (err: any) {
        results.failed++;
        results.errors.push({ email: dto.email, error: err.message });
      }
    }

    // Enqueue all invitation emails in a single Redis call after DB writes finish
    if (emailJobs.length > 0) {
      await this.emailQueueService.enqueueBulkFellowInvitations(emailJobs);
      results.emailsQueued = emailJobs.length;
    }

    const emailNote = sendEmails
      ? ` ${results.emailsQueued} invitation email(s) queued for background delivery.`
      : '';

    return {
      message: `Bulk creation complete. ${results.created} created, ${results.failed} failed.${emailNote}`,
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
      'region',      // also stored directly on user so profile page reads it
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

  async resetFellowPassword(id: string) {
    const fellow = await this.userModel.findById(id).select('email firstName');
    if (!fellow) throw new NotFoundException('Fellow not found');

    const temporaryPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    await this.userModel.findByIdAndUpdate(id, {
      password: hashedPassword,
      mustSetPassword: true,
    });

    return {
      message: 'Temporary password reset successfully.',
      email: fellow.email,
      temporaryPassword,
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

  async getFellowById(id: string) {
    const fellow = await this.userModel.findById(id).select('-password').lean();
    if (!fellow) throw new NotFoundException('Fellow not found');
    return fellow;
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

    for (const instructor of instructors) {
      if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor) {
        this.emailService
          .sendCourseApprovalEmailToInstructor(String(instructor.email), String(instructor.firstName), updatedCourse.title)
          .catch((e) => console.error('Failed to send course approval email:', e.message));
      }
    }

    const mainInstructor = instructors[0] as any;
    if (mainInstructor?.email) {
      this.emailService
        .sendInstructorRegistrationNotificationToAdmin(
          'faith.muiruri@strathmore.edu',
          `${mainInstructor.firstName || ''} ${mainInstructor.lastName || ''}`,
          String(mainInstructor.email),
          updatedCourse.title,
          `Course APPROVED`,
          updatedCourse._id.toString(),
        )
        .catch((e) => console.error('Failed to send admin notification (course approve):', e.message));
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

    for (const instructor of instructors) {
      if (instructor && typeof instructor === 'object' && 'email' in instructor && 'firstName' in instructor) {
        this.emailService
          .sendCourseRejectionEmailToInstructor(String(instructor.email), String(instructor.firstName), updatedCourse.title, reason)
          .catch((e) => console.error('Failed to send course rejection email:', e.message));
      }
    }

    const mainInstructorR = instructors[0] as any;
    if (mainInstructorR?.email) {
      this.emailService
        .sendInstructorRegistrationNotificationToAdmin(
          'faith.muiruri@strathmore.edu',
          `${mainInstructorR.firstName || ''} ${mainInstructorR.lastName || ''}`,
          String(mainInstructorR.email),
          updatedCourse.title,
          `Course REJECTED - Reason: ${reason}`,
          updatedCourse._id.toString(),
        )
        .catch((e) => console.error('Failed to send admin notification (course reject):', e.message));
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
      throw new BadRequestException(`Migration failed: ${(error as any).message}`);
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
    const results: Array<{ message: string; student: any; course: any }> = [];
    const failed: Array<{ enrollmentId: string; error: string }> = [];

    for (const enrollmentId of enrollmentIds) {
      try {
        const result = await this.sendReminderToStudent(enrollmentId, message);
        results.push(result);
      } catch (error) {
        failed.push({ enrollmentId, error: (error as any).message });
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
    try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalEnrollments,
      completedEnrollments,
      activeEnrollments,
      totalModules,
      publishedModules,
      totalStudents,
      approvedInstructors,
    ] = await Promise.all([
      this.moduleEnrollmentModel.countDocuments(),
      this.moduleEnrollmentModel.countDocuments({ $or: [{ isCompleted: true }, { progress: { $gte: 100 } }] }),
      this.moduleEnrollmentModel.countDocuments({
        isCompleted: false,
        lastAccessedAt: { $gte: thirtyDaysAgo },
      }),
      this.moduleModel.countDocuments({ isActive: { $ne: false } }),
      this.moduleModel.countDocuments({ status: ModuleStatus.PUBLISHED, isActive: { $ne: false } }),
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
        total: totalModules,
        published: publishedModules,
      },
      users: {
        students: totalStudents,
        instructors: approvedInstructors,
      },
    };
    } catch (err) {
      console.error('getAnalyticsOverview error:', (err as any).message);
      const [students, instructors] = await Promise.all([
        this.userModel.countDocuments({ role: UserRole.STUDENT }).catch(() => 0),
        this.userModel.countDocuments({ role: UserRole.INSTRUCTOR, instructorStatus: InstructorStatus.APPROVED }).catch(() => 0),
      ]);
      return {
        enrollments: { total: 0, completed: 0, active: 0, completionRate: '0%' },
        courses: { total: 0, published: 0 },
        users: { students, instructors },
      };
    }
  }

  async getStudentProgressAnalytics(
    limit = 50,
    status: 'in-progress' | 'completed' | 'all' = 'all',
  ) {
    const filter: any = {};
    if (status === 'in-progress') filter.isCompleted = false;
    if (status === 'completed') filter.isCompleted = true;

    const progressData = await this.moduleEnrollmentModel
      .find(filter)
      .populate('studentId', 'firstName lastName email')
      .populate('moduleId', 'title level')
      .sort({ lastAccessedAt: -1 })
      .limit(limit)
      .lean();

    const students = progressData.map((enrollment: any) => ({
      enrollmentId: enrollment._id,
      status: enrollment.isCompleted ? 'completed' : 'in-progress',
      studentId: enrollment.studentId?._id,
      studentName: `${enrollment.studentId?.firstName ?? ''} ${enrollment.studentId?.lastName ?? ''}`.trim(),
      studentEmail: enrollment.studentId?.email,
      courseId: enrollment.moduleId?._id,
      courseName: enrollment.moduleId?.title,
      level: enrollment.moduleId?.level,
      progress: enrollment.progress || 0,
      lastAccessed: enrollment.lastAccessedAt,
      enrolledAt: enrollment.createdAt,
      daysEnrolled: Math.floor(
        (new Date().getTime() - new Date(enrollment.createdAt ?? Date.now()).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    }));

    const avgProgress =
      students.length > 0
        ? students.reduce((sum, s) => sum + s.progress, 0) / students.length
        : 0;

    return {
      students,
      summary: { totalActive: students.length, averageProgress: avgProgress.toFixed(1) },
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
    const completionStats = await this.moduleEnrollmentModel.aggregate([
      {
        $group: {
          _id: '$moduleId',
          totalEnrollments: { $sum: 1 },
          completedCount: { $sum: { $cond: [{ $or: [{ $eq: ['$isCompleted', true] }, { $gte: ['$progress', 100] }] }, 1, 0] } },
          avgProgress: { $avg: '$progress' },
        },
      },
      {
        $lookup: {
          from: 'modules',
          localField: '_id',
          foreignField: '_id',
          as: 'module',
        },
      },
      { $unwind: { path: '$module', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          courseId: '$_id',
          courseName: '$module.title',
          level: '$module.level',
          totalEnrollments: 1,
          completedCount: 1,
          completionRate: {
            $round: [
              { $multiply: [{ $divide: ['$completedCount', '$totalEnrollments'] }, 100] },
              1,
            ],
          },
          avgProgress: { $round: ['$avgProgress', 1] },
        },
      },
      { $sort: { completionRate: -1 } },
    ]);

    const overallStats = await this.moduleEnrollmentModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: ['$isCompleted', 1, 0] } },
          avgProgress: { $avg: '$progress' },
        },
      },
    ]);

    const overall = overallStats[0] || { total: 0, completed: 0, avgProgress: 0 };
    const overallCompletionRate =
      overall.total > 0 ? ((overall.completed / overall.total) * 100).toFixed(1) : 0;

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

  // ── Assessment Insights ────────────────────────────────────────────────────
  async getAssessmentInsights() {
    const [finalStats, moduleStats, coursePerformance, scoreDistRaw] =
      await Promise.all([
        // Overall final-assessment stats from ModuleEnrollment
        this.moduleEnrollmentModel.aggregate([
          { $match: { finalAssessmentAttempts: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              avgScore: { $avg: '$finalAssessmentScore' },
              passedCount: { $sum: { $cond: ['$finalAssessmentPassed', 1, 0] } },
              totalAttempted: { $sum: 1 },
              avgAttempts: { $avg: '$finalAssessmentAttempts' },
              retakers: { $sum: { $cond: [{ $gt: ['$finalAssessmentAttempts', 1] }, 1, 0] } },
            },
          },
        ]),

        // Module-level lesson assessment stats
        this.moduleEnrollmentModel.aggregate([
          { $unwind: { path: '$lessonProgress', preserveNullAndEmptyArrays: false } },
          { $match: { 'lessonProgress.assessmentAttempts': { $gt: 0 } } },
          {
            $group: {
              _id: null,
              avgScore: { $avg: '$lessonProgress.lastScore' },
              passedCount: { $sum: { $cond: [{ $gt: ['$lessonProgress.lastScore', 60] }, 1, 0] } },
              totalAttempted: { $sum: 1 },
              avgAttempts: { $avg: '$lessonProgress.assessmentAttempts' },
              retakers: { $sum: { $cond: [{ $gt: ['$lessonProgress.assessmentAttempts', 1] }, 1, 0] } },
            },
          },
        ]),

        // Per-module assessment performance
        this.moduleEnrollmentModel.aggregate([
          { $match: { finalAssessmentAttempts: { $gt: 0 } } },
          {
            $group: {
              _id: '$moduleId',
              avgScore: { $avg: '$finalAssessmentScore' },
              passedCount: { $sum: { $cond: ['$finalAssessmentPassed', 1, 0] } },
              totalAttempted: { $sum: 1 },
              avgAttempts: { $avg: '$finalAssessmentAttempts' },
            },
          },
          { $lookup: { from: 'modules', localField: '_id', foreignField: '_id', as: 'module' } },
          { $unwind: { path: '$module', preserveNullAndEmptyArrays: false } },
          {
            $project: {
              courseId: '$_id',
              courseName: '$module.title',
              avgScore: { $round: ['$avgScore', 1] },
              passRate: {
                $round: [{ $multiply: [{ $divide: ['$passedCount', '$totalAttempted'] }, 100] }, 1],
              },
              avgAttempts: { $round: ['$avgAttempts', 1] },
              totalAttempted: 1,
            },
          },
          { $sort: { avgScore: 1 } },
        ]),

        // Score distribution buckets
        this.moduleEnrollmentModel.aggregate([
          { $match: { finalAssessmentAttempts: { $gt: 0 } } },
          {
            $addFields: {
              scoreBucket: {
                $switch: {
                  branches: [
                    { case: { $lte: ['$finalAssessmentScore', 20] }, then: '0-20' },
                    { case: { $lte: ['$finalAssessmentScore', 40] }, then: '21-40' },
                    { case: { $lte: ['$finalAssessmentScore', 60] }, then: '41-60' },
                    { case: { $lte: ['$finalAssessmentScore', 80] }, then: '61-80' },
                    { case: { $lte: ['$finalAssessmentScore', 100] }, then: '81-100' },
                  ],
                  default: '0-20',
                },
              },
            },
          },
          { $group: { _id: '$scoreBucket', count: { $sum: 1 } } },
        ]),
      ]);

    const fs = finalStats[0] || {};
    const ms = moduleStats[0] || {};
    const ORDER = ['0-20', '21-40', '41-60', '61-80', '81-100'];

    return {
      finalAssessment: {
        avgScore: Math.round(fs.avgScore || 0),
        passedCount: fs.passedCount || 0,
        totalAttempted: fs.totalAttempted || 0,
        passRate:
          fs.totalAttempted > 0
            ? +((fs.passedCount / fs.totalAttempted) * 100).toFixed(1)
            : 0,
        avgAttempts: +(fs.avgAttempts || 1).toFixed(1),
        retakeRate:
          fs.totalAttempted > 0
            ? +((fs.retakers / fs.totalAttempted) * 100).toFixed(1)
            : 0,
      },
      moduleAssessment: {
        avgScore: Math.round(ms.avgScore || 0),
        totalAttempted: ms.totalAttempted || 0,
        passRate:
          ms.totalAttempted > 0
            ? +((ms.passedCount / ms.totalAttempted) * 100).toFixed(1)
            : 0,
        avgAttempts: +(ms.avgAttempts || 1).toFixed(1),
        retakeRate:
          ms.totalAttempted > 0
            ? +((ms.retakers / ms.totalAttempted) * 100).toFixed(1)
            : 0,
      },
      scoreDistribution: ORDER.map((range) => ({
        range: `${range}%`,
        count: scoreDistRaw.find((b: any) => b._id === range)?.count || 0,
      })),
      coursePerformance,
    };
  }

  // ── Learning Behaviour (peak hours / day-of-week) ──────────────────────────
  async getLearningBehaviorAnalytics(period = 'weekly') {
    const LessonCompletion = this.userModel.db.model('LessonCompletion');

    const now = new Date();
    const MS = {
      daily: 24 * 3600 * 1000,
      weekly: 7 * 24 * 3600 * 1000,
      monthly: 30 * 24 * 3600 * 1000,
      quarterly: 90 * 24 * 3600 * 1000,
      yearly: 365 * 24 * 3600 * 1000,
    };
    const startDate = new Date(
      now.getTime() - (MS[period] ?? MS.weekly),
    );

    const [hourlyRaw, dayRaw] = await Promise.all([
      LessonCompletion.aggregate([
        { $match: { completedAt: { $gte: startDate, $lte: now } } },
        {
          $group: {
            _id: { $hour: '$completedAt' },
            completions: { $sum: 1 },
            uniqueStudents: { $addToSet: '$studentId' },
          },
        },
        {
          $project: {
            hour: '$_id',
            completions: 1,
            students: { $size: '$uniqueStudents' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      LessonCompletion.aggregate([
        { $match: { completedAt: { $gte: startDate, $lte: now } } },
        {
          $group: {
            _id: { $dayOfWeek: '$completedAt' },
            completions: { $sum: 1 },
            uniqueStudents: { $addToSet: '$studentId' },
          },
        },
        {
          $project: {
            dow: '$_id',
            completions: 1,
            students: { $size: '$uniqueStudents' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Full 24-hour array
    const hourMap = new Map(hourlyRaw.map((h: any) => [h.hour, h]));
    const peakHours = Array.from({ length: 24 }, (_, h) => {
      const d = hourMap.get(h) as any;
      const label =
        h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`;
      return {
        hour: h,
        label,
        completions: d?.completions || 0,
        students: d?.students || 0,
      };
    });

    // Monday→Sunday (MongoDB: 1=Sun 2=Mon … 7=Sat)
    const DOW_NAMES = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayMap = new Map(dayRaw.map((d: any) => [d.dow, d]));
    const weekdays = [2, 3, 4, 5, 6, 7, 1].map((dow) => {
      const d = dayMap.get(dow) as any;
      return {
        day: DOW_NAMES[dow],
        completions: d?.completions || 0,
        students: d?.students || 0,
      };
    });

    const totalCompletions = peakHours.reduce(
      (s, h) => s + h.completions,
      0,
    );
    const peakHour = peakHours.reduce(
      (mx, h) => (h.completions > mx.completions ? h : mx),
      peakHours[0],
    );
    const peakDay = weekdays.reduce(
      (mx, d) => (d.completions > mx.completions ? d : mx),
      weekdays[0],
    );

    return {
      period,
      peakHours,
      weekdays,
      totalCompletions,
      peakHour: peakHour?.label ?? 'N/A',
      peakDay: peakDay?.day ?? 'N/A',
    };
  }

  // ── Engagement Analytics ────────────────────────────────────────────────────
  async getEngagementAnalytics() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [active, atRisk, dormant, total, topStudents, atRiskList] =
      await Promise.all([
        this.userModel.countDocuments({
          role: UserRole.STUDENT,
          lastLogin: { $gte: sevenDaysAgo },
        }),
        this.userModel.countDocuments({
          role: UserRole.STUDENT,
          lastLogin: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo },
        }),
        this.userModel.countDocuments({
          role: UserRole.STUDENT,
          $or: [
            { lastLogin: { $lt: thirtyDaysAgo } },
            { lastLogin: null },
          ],
        }),
        this.userModel.countDocuments({ role: UserRole.STUDENT }),

        // Top students by engagement score — uses ModuleEnrollment
        this.moduleEnrollmentModel.aggregate([
          {
            $group: {
              _id: '$studentId',
              avgProgress: { $avg: '$progress' },
              completedCourses: { $sum: { $cond: ['$isCompleted', 1, 0] } },
              totalEnrollments: { $sum: 1 },
              lastActive: { $max: '$lastAccessedAt' },
            },
          },
          {
            $addFields: {
              engagementScore: {
                $add: [
                  { $multiply: ['$avgProgress', 0.5] },
                  { $multiply: [{ $min: ['$totalEnrollments', 5] }, 10] },
                ],
              },
            },
          },
          { $sort: { engagementScore: -1 } },
          { $limit: 10 },
          {
            $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' },
          },
          { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
          {
            $project: {
              name: { $concat: ['$student.firstName', ' ', '$student.lastName'] },
              email: '$student.email',
              country: '$student.country',
              level: '$student.fellowData.track',
              avgProgress: { $round: ['$avgProgress', 1] },
              completedCourses: 1,
              totalEnrollments: 1,
              lastActive: 1,
              engagementScore: { $round: ['$engagementScore', 0] },
            },
          },
        ]),

        // At-risk students — uses ModuleEnrollment
        this.moduleEnrollmentModel.aggregate([
          {
            $match: {
              isCompleted: false,
              progress: { $lt: 50 },
              $or: [
                { lastAccessedAt: { $lt: sevenDaysAgo } },
                { lastAccessedAt: null },
              ],
            },
          },
          {
            $group: {
              _id: '$studentId',
              avgProgress: { $avg: '$progress' },
              coursesAtRisk: { $sum: 1 },
              lastActive: { $max: '$lastAccessedAt' },
              daysInactive: {
                $max: {
                  $divide: [
                    { $subtract: [now, { $ifNull: ['$lastAccessedAt', new Date(0)] }] },
                    86400000,
                  ],
                },
              },
            },
          },
          { $sort: { avgProgress: 1 } },
          { $limit: 10 },
          {
            $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' },
          },
          { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
          {
            $project: {
              name: { $concat: ['$student.firstName', ' ', '$student.lastName'] },
              email: '$student.email',
              country: '$student.country',
              avgProgress: { $round: ['$avgProgress', 1] },
              coursesAtRisk: 1,
              lastActive: 1,
              daysInactive: { $round: ['$daysInactive', 0] },
            },
          },
        ]),
      ]);

    return {
      summary: {
        totalStudents: total,
        activeStudents: active,
        atRiskStudents: atRisk,
        dormantStudents: dormant,
        activeRate:
          total > 0 ? +((active / total) * 100).toFixed(1) : 0,
      },
      topStudents,
      atRiskList,
    };
  }

  // ── Demographic Analytics ──────────────────────────────────────────────────
  async getDemographicAnalytics() {
    const now = new Date();
    const twelveMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 11,
      1,
    );
    const MONTHS = [
      'Jan','Feb','Mar','Apr','May','Jun',
      'Jul','Aug','Sep','Oct','Nov','Dec',
    ];

    const [genderRaw, countryRaw, cohortRaw, regTrendRaw] =
      await Promise.all([
        this.userModel.aggregate([
          {
            $match: {
              role: UserRole.STUDENT,
              gender: { $nin: [null, ''] },
            },
          },
          { $group: { _id: '$gender', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        this.userModel.aggregate([
          {
            $match: {
              role: UserRole.STUDENT,
              country: { $nin: [null, ''] },
            },
          },
          { $group: { _id: '$country', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 15 },
        ]),
        this.userModel.aggregate([
          {
            $match: {
              role: UserRole.STUDENT,
              'fellowData.cohort': { $nin: [null, ''] },
            },
          },
          {
            $group: {
              _id: '$fellowData.cohort',
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        this.userModel.aggregate([
          {
            $match: {
              role: UserRole.STUDENT,
              createdAt: { $gte: twelveMonthsAgo },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
      ]);

    return {
      genderDistribution: genderRaw.map((g: any) => ({
        gender: g._id,
        count: g.count,
      })),
      countryDistribution: countryRaw.map((c: any) => ({
        country: c._id,
        count: c.count,
      })),
      cohortDistribution: cohortRaw.map((c: any) => ({
        cohort: c._id,
        count: c.count,
      })),
      registrationTrend: regTrendRaw.map((r: any) => ({
        month: MONTHS[r._id.month - 1],
        year: r._id.year,
        label: `${MONTHS[r._id.month - 1]} ${r._id.year}`,
        count: r.count,
      })),
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
        (error as any).message || 'Failed to upload course format',
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
        (error as any).message || 'Failed to fetch course format',
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
        (error as any).message || 'Failed to delete course format',
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

    for (const instructor of moduleDoc.instructorIds as any[]) {
      if (instructor && typeof instructor === 'object' && 'email' in instructor) {
        this.emailService
          .sendModuleApprovalEmailToInstructor(String(instructor.email), String(instructor.firstName || ''), moduleDoc.title)
          .catch((e) => console.error('Failed to send module approval email:', e.message));
      }
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

    for (const instructor of moduleDoc.instructorIds as any[]) {
      if (instructor && typeof instructor === 'object' && 'email' in instructor) {
        this.emailService
          .sendModuleRejectionEmailToInstructor(String(instructor.email), String(instructor.firstName || ''), moduleDoc.title, reason)
          .catch((e) => console.error('Failed to send module rejection email:', e.message));
      }
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

  // ── Finalize module content (admin, bypasses ownership check) ──────────────
  async finalizeContentAsAdmin(moduleId: string, adminId: string): Promise<ModuleEntity> {
    const moduleDoc = await this.moduleModel.findById(moduleId);
    if (!moduleDoc) throw new NotFoundException('Module not found');
    moduleDoc.isContentFinalized = true;
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
      this.moduleEnrollmentModel.countDocuments({ $or: [{ isCompleted: true }, { progress: { $gte: 100 } }] }),
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
    notStartedModules: number;
    overallProgressPct: number;
    lastAccessedAt: Date | null;
    currentModuleTitle: string | null;
    currentModuleProgress: number;
    currentLessonIndex: number;
    isSuspended: boolean;
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

    const isSuspended = !!(fellow.fellowData?.isSuspended);

    const emptyResult = {
      totalModules: 0, enrolledModules: 0, completedModules: 0,
      inProgressModules: 0, notStartedModules: 0, overallProgressPct: 0,
      lastAccessedAt: null, currentModuleTitle: null, currentModuleProgress: 0,
      currentLessonIndex: 0, isSuspended, categories: [],
    };

    if (assignedCategoryIds.length === 0) return emptyResult;

    // Fetch all modules in assigned categories
    const modules = await this.moduleModel
      .find({ categoryId: { $in: assignedCategoryIds } })
      .select('_id title level categoryId')
      .lean();

    if (modules.length === 0) return emptyResult;

    const moduleIds = modules.map((m) => m._id);

    // Fetch all enrollments for this fellow in those modules
    const enrollments = await this.moduleEnrollmentModel
      .find({
        studentId: new Types.ObjectId(fellow._id.toString()),
        moduleId: { $in: moduleIds },
      })
      .select('moduleId progress isCompleted lastAccessedAt lastAccessedLesson')
      .lean();

    const enrollmentMap = new Map(
      enrollments.map((e) => [(e.moduleId as any).toString(), e]),
    );

    let completedCount = 0;
    let inProgressCount = 0;
    let latestAccess: Date | null = null;
    let currentEnrollment: any = null;

    for (const enr of enrollments) {
      if (enr.isCompleted) completedCount++;
      else if ((enr.progress || 0) > 0) inProgressCount++;
      if (enr.lastAccessedAt) {
        if (!latestAccess || enr.lastAccessedAt > latestAccess) {
          latestAccess = enr.lastAccessedAt;
          if (!enr.isCompleted) currentEnrollment = enr;
        }
      }
    }

    // If no in-progress found, pick the most recently accessed incomplete one
    if (!currentEnrollment) {
      const incomplete = enrollments
        .filter((e) => !e.isCompleted)
        .sort((a, b) => ((b.lastAccessedAt as any) || 0) - ((a.lastAccessedAt as any) || 0));
      currentEnrollment = incomplete[0] || null;
    }

    let currentModuleTitle: string | null = null;
    let currentModuleProgress = 0;
    let currentLessonIndex = 0;
    if (currentEnrollment) {
      const mod = modules.find((m) => (m._id as any).toString() === (currentEnrollment.moduleId as any).toString());
      currentModuleTitle = (mod as any)?.title || null;
      currentModuleProgress = currentEnrollment.progress || 0;
      currentLessonIndex = (currentEnrollment.lastAccessedLesson || 0) + 1;
    }

    const notStartedCount = modules.length - enrollments.length;
    const overallProgressPct = modules.length > 0
      ? Math.round((completedCount / modules.length) * 100)
      : 0;

    // Category-level breakdown
    const categoryMap = new Map<string, any>();
    for (const cat of assignedCategoryIds) {
      const catId = cat.toString();
      categoryMap.set(catId, { categoryId: catId, categoryName: '', totalModules: 0, completedModules: 0, progressPct: 0 });
    }

    for (const mod of modules) {
      const catId = (mod.categoryId as any).toString();
      const entry = categoryMap.get(catId);
      if (!entry) continue;
      entry.totalModules++;
      const enr = enrollmentMap.get((mod._id as any).toString());
      if (enr?.isCompleted) entry.completedModules++;
    }

    const categories = await this.categoryModel
      .find({ _id: { $in: assignedCategoryIds } })
      .select('_id name')
      .lean();

    for (const cat of categories) {
      const entry = categoryMap.get((cat._id as any).toString());
      if (entry) {
        entry.categoryName = (cat as any).name;
        entry.progressPct = entry.totalModules > 0
          ? Math.round((entry.completedModules / entry.totalModules) * 100)
          : 0;
      }
    }

    return {
      totalModules: modules.length,
      enrolledModules: enrollments.length,
      completedModules: completedCount,
      inProgressModules: inProgressCount,
      notStartedModules: notStartedCount < 0 ? 0 : notStartedCount,
      overallProgressPct,
      lastAccessedAt: latestAccess,
      currentModuleTitle,
      currentModuleProgress,
      currentLessonIndex,
      isSuspended,
      categories: Array.from(categoryMap.values()),
    };
  }

  /**
   * GET /admin/fellows/progress — list all fellows with real progress data.
   * Supports filters: status, category, cohort, risk, search, page, limit.
   */
  async getFellowsProgress(filters: {
    search?: string;
    module?: string;
    status?: string;
    categoryId?: string;
    cohort?: string;
    risk?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { search, module, status } = filters;
    const pipeline: any[] = [];

    if (module && module !== 'all' && Types.ObjectId.isValid(module)) {
      pipeline.push({
        $match: {
          moduleId: new Types.ObjectId(module),
        },
      });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $lookup: {
          from: 'modules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module',
        },
      },
      {
        $match: {
          'user.0.role': UserRole.STUDENT,
          'user.0.userType': 'fellow',
        },
      },
      {
        $project: {
          progress: 1,
          isCompleted: 1,
          completedLessons: 1,
          totalLessons: 1,
          finalAssessmentPassed: 1,
          fullName: { $arrayElemAt: ['$user.fullName', 0] },
          email: { $arrayElemAt: ['$user.email', 0] },
          fellowId: { $arrayElemAt: ['$user.fellowData.fellowId', 0] },
          cohort: { $arrayElemAt: ['$user.fellowData.cohort', 0] },
          region: { $arrayElemAt: ['$user.fellowData.region', 0] },
          track: { $arrayElemAt: ['$user.fellowData.track', 0] },
          moduleId: { $arrayElemAt: ['$module._id', 0] },
          moduleTitle: { $arrayElemAt: ['$module.title', 0] },
          moduleOrder: { $arrayElemAt: ['$module.order', 0] },
          moduleLevel: { $arrayElemAt: ['$module.level', 0] },
          certificateEarned: 1,
        },
      },
    );

    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { fullName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ],
        },
      });
    }

    if (status && status !== 'all') {
      const statusMatch: Record<string, any> = {
        completed: { $or: [{ isCompleted: true }, { progress: 100 }] },
        inprogress: { progress: { $gt: 0, $lt: 100 } },
        notstarted: { $or: [{ progress: 0 }, { progress: { $exists: false } }] },
      };

      if (statusMatch[status]) {
        pipeline.push({ $match: statusMatch[status] });
      }
    }

    pipeline.push(
      {
        $group: {
          _id: '$email',
          fullName: { $first: '$fullName' },
          email: { $first: '$email' },
          fellowId: { $first: '$fellowId' },
          cohort: { $first: '$cohort' },
          region: { $first: '$region' },
          track: { $first: '$track' },
          modules: {
            $push: {
              moduleId: '$moduleId',
              title: '$moduleTitle',
              order: '$moduleOrder',
              level: '$moduleLevel',
              progress: '$progress',
              isCompleted: '$isCompleted',
              completedLessons: '$completedLessons',
              totalLessons: '$totalLessons',
              finalAssessmentPassed: '$finalAssessmentPassed',
            },
          },
          // true if ANY beginner enrollment for this fellow has certificateEarned set
          certificateEarned: { $max: '$certificateEarned' },
        },
      },
      { $sort: { fullName: 1 } },
    );

    return this.moduleEnrollmentModel.aggregate(pipeline);
  }

  async getFellowsProgressLegacy(filters: {
    status?: string;
    module?: string;
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
   * Admin actions: allow_proceed | suspend | unsuspend | deactivate | mark_completed
   */
  async updateFellowProgressAction(
    adminId: string,
    fellowId: string,
    action: 'allow_proceed' | 'suspend' | 'unsuspend' | 'deactivate' | 'mark_completed',
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
        updateFields = { isActive: true, 'fellowData.isSuspended': false };
        activityMessage = `Fellow ${name} marked as eligible to proceed`;
        emailSubject = 'You are eligible to proceed — ARIN Fellowship';
        emailBody = `Dear ${fellow.firstName},\n\nGreat news! The admin has reviewed your progress and confirmed you are eligible to continue to the next stage of your fellowship.\n\n${note ? `Note from admin: ${note}\n\n` : ''}Keep up the excellent work!\n\nARIN eLearning Team`;
        break;
      case 'suspend':
        updateFields = { 'fellowData.isSuspended': true };
        activityMessage = `Fellow ${name} suspended`;
        emailSubject = 'Your Fellowship Access Has Been Suspended — ARIN Academy';
        emailBody = `Dear ${fellow.firstName},\n\nYour access to the fellowship modules has been temporarily suspended by an administrator.\n\n${note ? `Reason: ${note}\n\n` : ''}Please contact us if you have any questions.\n\nARIN eLearning Team`;
        break;
      case 'unsuspend':
        updateFields = { 'fellowData.isSuspended': false };
        activityMessage = `Fellow ${name} unsuspended (access restored)`;
        emailSubject = 'Your Fellowship Access Has Been Restored — ARIN Academy';
        emailBody = `Dear ${fellow.firstName},\n\nYour access to the fellowship modules has been restored. You may now continue your learning journey.\n\n${note ? `Note from admin: ${note}\n\n` : ''}Welcome back!\n\nARIN eLearning Team`;
        break;
      case 'deactivate':
        updateFields = { isActive: false, 'fellowData.isSuspended': true };
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
      this.moduleEnrollmentModel.countDocuments({ $or: [{ isCompleted: true }, { progress: { $gte: 100 } }] }),
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

  /**
   * GET /admin/fellows/learning-analytics
   * Aggregate module enrollment lastAccessedAt timestamps into hour-of-day
   * and day-of-week buckets so the admin can see WHEN fellows are learning.
   */
  async getLearningAnalytics(filters: { categoryId?: string; days?: number } = {}) {
    const { categoryId, days = 90 } = filters;
    const since = new Date(Date.now() - days * 86400000);

    // Build list of fellow student IDs
    const fellowIds = await this.userModel.distinct('_id', {
      'fellowData.fellowId': { $exists: true },
      ...(categoryId ? { 'fellowData.assignedCategories': new Types.ObjectId(categoryId) } : {}),
    });

    // Gather all enrollment lastAccessedAt within the window
    const enrollments = await this.moduleEnrollmentModel
      .find({
        studentId: { $in: fellowIds },
        lastAccessedAt: { $gte: since },
      })
      .select('lastAccessedAt studentId')
      .lean();

    // Bucket by hour-of-day (0–23) and day-of-week (0=Sun … 6=Sat)
    const hourCounts = new Array(24).fill(0);
    const dayCounts  = new Array(7).fill(0);
    const dailyMap   = new Map<string, number>(); // ISO date → count

    for (const enr of enrollments) {
      if (!enr.lastAccessedAt) continue;
      const d = new Date(enr.lastAccessedAt);
      hourCounts[d.getHours()]++;
      dayCounts[d.getDay()]++;
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) || 0) + 1);
    }

    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build a 30-day rolling daily series (last 30 days for the chart)
    const dailySeries: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      dailySeries.push({ date: key, count: dailyMap.get(key) || 0 });
    }

    // Peak hour / peak day
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakDay  = dayCounts.indexOf(Math.max(...dayCounts));

    return {
      totalSessions: enrollments.length,
      activeFellows: new Set(enrollments.map((e) => (e.studentId as any).toString())).size,
      hourOfDay: hourCounts.map((count, hour) => ({ hour, label: `${hour}:00`, count })),
      dayOfWeek: dayCounts.map((count, day) => ({ day, label: DAY_LABELS[day], count })),
      dailySeries,
      peakHour: { hour: peakHour, label: `${peakHour}:00` },
      peakDay:  { day: peakDay,  label: DAY_LABELS[peakDay] },
      windowDays: days,
    };
  }

  // ===================== CERTIFICATE MANAGEMENT =====================

  async getModuleCertificates(level?: string) {
    const moduleQuery: any = {};
    if (level) moduleQuery.level = level;

    // Only count published + active modules as the completion threshold
    moduleQuery.status = ModuleStatus.PUBLISHED;
    moduleQuery.isActive = { $ne: false };

    const modules = await this.moduleModel.find(moduleQuery).select('_id title level').lean();
    const moduleIds = modules.map((m) => m._id);

    if (moduleIds.length === 0) return { success: true, data: [] };

    // Count required modules per level and map moduleId → level
    const modulesPerLevel = new Map<string, number>();
    const moduleIdToLevel = new Map<string, string>();
    for (const m of modules) {
      const lvl = (m.level as string) || 'beginner';
      modulesPerLevel.set(lvl, (modulesPerLevel.get(lvl) || 0) + 1);
      moduleIdToLevel.set((m._id as any).toString(), lvl);
    }

    const enrollments = await this.moduleEnrollmentModel
      .find({
        moduleId: { $in: moduleIds },
        $or: [{ isCompleted: true }, { progress: 100 }],
      })
      .populate('studentId', 'fullName firstName lastName email profileImage')
      .populate('moduleId', 'title level')
      .lean();

    // Group by (studentId + level) so each tab gets accurate completion counts
    const studentLevelMap = new Map<string, any>();
    for (const e of enrollments) {
      const sid = (e.studentId as any)?._id?.toString() || (e.studentId as any)?.toString();
      if (!sid) continue;

      const modLevel: string =
        (e.moduleId as any)?.level ||
        moduleIdToLevel.get((e.moduleId as any)?._id?.toString() || (e.moduleId as any)?.toString() || '') ||
        'beginner';
      const key = `${sid}_${modLevel}`;

      if (!studentLevelMap.has(key)) {
        studentLevelMap.set(key, {
          studentId: sid,
          level: modLevel,
          student: e.studentId,
          enrollments: [],
          latestEnrollmentId: (e._id as any).toString(),
          latestCompletedDate: e.completedAt,
          certificateEarned: false,
          certificatePublicId: null,
          certificateIssuedAt: null,
          totalScore: 0,
        });
      }

      const entry = studentLevelMap.get(key);
      entry.enrollments.push(e);
      entry.totalScore += e.finalAssessmentScore || 0;

      if (e.certificateEarned && !entry.certificateEarned) {
        entry.certificateEarned = true;
        entry.certificatePublicId = e.certificatePublicId;
        entry.certificateIssuedAt = (e as any).certificateIssuedAt;
      }

      if (e.completedAt && (!entry.latestCompletedDate || e.completedAt > entry.latestCompletedDate)) {
        entry.latestCompletedDate = e.completedAt;
        entry.latestEnrollmentId = (e._id as any).toString();
      }
    }

    // ── Cross-reference the ModuleCertificate collection as the authoritative source ──
    // The certificateEarned flag on enrollments can fall out of sync; the
    // ModuleCertificate document is always created when a cert is issued, so it is
    // the definitive record.
    const studentIdsToCheck = [...studentLevelMap.keys()]
      .map((key) => key.split('_')[0])
      .filter((sid) => Types.ObjectId.isValid(sid))
      .map((sid) => new Types.ObjectId(sid));

    if (studentIdsToCheck.length > 0) {
      const issuedCerts = await this.moduleCertificateModel
        .find({ studentId: { $in: studentIdsToCheck } })
        .lean();

      for (const cert of issuedCerts) {
        const key = `${(cert.studentId as any).toString()}_${cert.moduleLevel}`;
        if (studentLevelMap.has(key)) {
          const entry = studentLevelMap.get(key);
          entry.certificateEarned = true;
          entry.certificatePublicId = entry.certificatePublicId || cert.publicId;
          entry.certificateIssuedAt = entry.certificateIssuedAt || cert.issuedDate;
        }
      }
    }

    const result: any[] = [];
    for (const [, entry] of studentLevelMap) {
      const requiredCount = modulesPerLevel.get(entry.level) || 0;
      // Only include students who completed ALL modules at their level
      if (entry.enrollments.length < requiredCount) continue;

      const student = entry.student as any;
      const avgScore = Math.round(entry.totalScore / entry.enrollments.length);
      const name =
        student?.fullName ||
        `${student?.firstName || ''} ${student?.lastName || ''}`.trim() ||
        'Unknown Student';

      result.push({
        id: `${entry.studentId}_${entry.level}`,
        studentId: entry.studentId,
        enrollmentId: entry.latestEnrollmentId,
        name,
        email: student?.email || '',
        avatar: student?.profileImage || '',
        level: entry.level,
        completedModules: entry.enrollments.length,
        totalModules: requiredCount,
        completedDate: entry.latestCompletedDate,
        score: avgScore,
        grade: avgScore >= 90 ? 'A' : avgScore >= 80 ? 'B' : avgScore >= 70 ? 'C' : avgScore >= 60 ? 'D' : 'F',
        status: entry.certificateEarned ? 'issued' : 'pending',
        certificatePublicId: entry.certificatePublicId || null,
        issuedDate: entry.certificateIssuedAt || null,
        certificateId: entry.certificatePublicId
          ? `CERT-${entry.certificatePublicId.slice(0, 8).toUpperCase()}`
          : null,
      });
    }

    return { success: true, data: result };
  }

  async issueBeginnerCertificate(enrollmentId: string) {
    const enrollment = await this.moduleEnrollmentModel
      .findById(enrollmentId)
      .populate('moduleId')
      .populate('studentId', 'fullName firstName lastName email');

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (!enrollment.isCompleted && (enrollment as any).progress !== 100) throw new BadRequestException('Module not yet completed by student');

    const mod = enrollment.moduleId as any;
    const modLevel = mod?.level || 'beginner';

    // Check ModuleCertificate collection (authoritative) — also catches cases where
    // the certificateEarned flag on enrollment fell out of sync
    const existingCert = await this.moduleCertificateModel.findOne({
      studentId: enrollment.studentId,
      moduleLevel: modLevel,
    });
    if (existingCert || enrollment.certificateEarned) throw new BadRequestException('Certificate already issued');

    const student = enrollment.studentId as any;
    const studentName =
      student?.fullName ||
      `${student?.firstName || ''} ${student?.lastName || ''}`.trim() ||
      'Student';

    const certificateNumber = `MC-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const publicId = crypto.randomUUID();

    await this.moduleCertificateModel.create({
      studentId: enrollment.studentId,
      moduleId: mod._id,
      enrollmentId: enrollment._id,
      studentName,
      moduleName: `${mod.level ? mod.level.charAt(0).toUpperCase() + mod.level.slice(1) : 'Beginner'} Level Certificate`,
      moduleLevel: mod.level || 'beginner',
      categoryName: 'ARIN Academy',
      scoreAchieved: enrollment.finalAssessmentScore || 0,
      instructorName: 'ARIN Academy',
      issuedDate: new Date(),
      certificateNumber,
      publicId,
    });

    // Mark ALL same-level enrollments for this student as certificateEarned
    const sameLevelModules = await this.moduleModel.find({ level: mod.level }).select('_id').lean();
    const sameLevelModuleIds = sameLevelModules.map((m) => m._id);
    await this.moduleEnrollmentModel.updateMany(
      { studentId: enrollment.studentId, moduleId: { $in: sameLevelModuleIds }, isCompleted: true },
      { $set: { certificateEarned: true, certificatePublicId: publicId, certificateIssuedAt: new Date() } },
    );

    return { success: true, message: 'Certificate issued successfully', publicId };
  }

  async resetCertificate(studentId: string, level: string) {
    // Remove the ModuleCertificate record(s) for this student+level
    await this.moduleCertificateModel.deleteMany({
      studentId: new Types.ObjectId(studentId),
      moduleLevel: level,
    });

    // Reset all same-level enrollments back to not earned
    const sameLevelModules = await this.moduleModel
      .find({ level })
      .select('_id')
      .lean();
    const sameLevelModuleIds = sameLevelModules.map((m) => m._id);

    await this.moduleEnrollmentModel.updateMany(
      { studentId: new Types.ObjectId(studentId), moduleId: { $in: sameLevelModuleIds } },
      { $set: { certificateEarned: false, certificatePublicId: null, certificateIssuedAt: null } },
    );

    return { success: true, message: 'Certificate reset to pending' };
  }

  async issueAllCertificates(level: string) {
    const result = await this.getModuleCertificates(level);
    const pending = (result.data || []).filter((s: any) => s.status === 'pending');
    let issued = 0;
    let failed = 0;
    const details: any[] = [];
    for (const student of pending) {
      try {
        await this.issueBeginnerCertificate(student.enrollmentId);
        issued++;
        details.push({ name: student.name, success: true });
      } catch (err) {
        failed++;
        details.push({ name: student.name, success: false, error: (err as any)?.message });
      }
    }
    return { success: true, issued, failed, total: pending.length, details };
  }

  // ===================== MICROGRANTS =====================

  /**
   * Score a single fellow for microgrant eligibility.
   * Weights: assessment 40%, engagement 35%, activity 25%.
   */
  private scoreFellow(fellow: any, enrollments: any[]): {
    assessmentScore: number;
    engagementScore: number;
    activityScore: number;
    compositeScore: number;
    completedModules: number;
    totalModules: number;
    daysSinceLastLogin: number;
  } {
    const completedModules = enrollments.filter((e) => e.isCompleted).length;
    const totalModules = enrollments.length || 1;

    // Assessment score — average of all module finalAssessmentScore values
    const scored = enrollments.filter((e) => (e.finalAssessmentScore ?? 0) > 0);
    const assessmentScore = scored.length > 0
      ? Math.round(scored.reduce((s, e) => s + (e.finalAssessmentScore || 0), 0) / scored.length)
      : 0;

    // Engagement — % of modules completed
    const engagementScore = Math.round((completedModules / totalModules) * 100);

    // Activity — recency of last login (100 = today, 0 = 90+ days)
    const lastLogin = fellow.lastLogin ? new Date(fellow.lastLogin) : null;
    const daysSinceLastLogin = lastLogin
      ? Math.floor((Date.now() - lastLogin.getTime()) / 86400000)
      : 999;
    const activityScore = Math.max(0, Math.round(100 - (daysSinceLastLogin / 90) * 100));

    const compositeScore = Math.round(
      assessmentScore * 0.40 +
      engagementScore * 0.35 +
      activityScore   * 0.25,
    );

    return {
      assessmentScore,
      engagementScore,
      activityScore,
      compositeScore,
      completedModules,
      totalModules,
      daysSinceLastLogin,
    };
  }

  /**
   * GET /admin/microgrants/eligible
   * Returns AI for Climate Resilience fellows ranked by composite score.
   * Optionally filters by minimum composite score threshold.
   */
  async getEligibleFellows(minScore = 0) {
    // Find the AI for Climate Resilience category
    const aiCategory = await this.categoryModel.findOne({
      name: { $regex: 'AI', $options: 'i' },
    }).lean();

    if (!aiCategory) {
      throw new NotFoundException('AI for Climate Resilience category not found');
    }

    const categoryId = (aiCategory._id as any).toString();

    // Fetch all fellows in this category
    const fellows = await this.userModel
      .find({
        'fellowData.fellowId': { $exists: true },
        'fellowData.assignedCategories': new Types.ObjectId(categoryId),
      })
      .select('firstName lastName email lastLogin fellowData profileImage')
      .lean();

    // Get all modules in this category
    const modules = await this.moduleModel
      .find({ categoryId: new Types.ObjectId(categoryId), isActive: { $ne: false } })
      .select('_id title level')
      .lean();

    const moduleIds = modules.map((m) => m._id);

    // Fetch all enrollments for these fellows in these modules
    const fellowIds = fellows.map((f) => (f._id as any));
    const enrollments = await this.moduleEnrollmentModel
      .find({
        studentId: { $in: fellowIds },
        moduleId: { $in: moduleIds },
      })
      .select('studentId moduleId isCompleted finalAssessmentScore progress lastAccessedAt')
      .lean();

    // Group enrollments per fellow
    const enrollmentMap = new Map<string, any[]>();
    for (const enr of enrollments) {
      const sid = (enr.studentId as any).toString();
      if (!enrollmentMap.has(sid)) enrollmentMap.set(sid, []);
      enrollmentMap.get(sid)!.push(enr);
    }

    // Fetch already-issued grants for this category to flag them
    const existingGrants = await this.micrograntModel
      .find({ categoryId: new Types.ObjectId(categoryId), status: { $in: [MicrograntStatus.APPROVED, MicrograntStatus.ISSUED] } })
      .select('studentId status amount issuedAt')
      .lean();
    const grantMap = new Map(existingGrants.map((g) => [(g.studentId as any).toString(), g]));

    // Score each fellow
    const scored = fellows.map((fellow) => {
      const sid = (fellow._id as any).toString();
      const fellowEnrollments = enrollmentMap.get(sid) || [];
      const scores = this.scoreFellow(fellow, fellowEnrollments);
      const existingGrant = grantMap.get(sid);

      return {
        studentId: sid,
        name: `${fellow.firstName || ''} ${fellow.lastName || ''}`.trim() || 'Unknown',
        email: fellow.email,
        cohort: fellow.fellowData?.cohort || '—',
        track: fellow.fellowData?.track || '—',
        profileImage: (fellow as any).profileImage || null,
        lastLogin: fellow.lastLogin || null,
        ...scores,
        alreadyGranted: !!existingGrant,
        existingGrant: existingGrant
          ? { status: existingGrant.status, amount: existingGrant.amount, issuedAt: existingGrant.issuedAt }
          : null,
      };
    });

    // Sort by composite score descending, filter by threshold
    const filtered = scored
      .filter((f) => f.compositeScore >= minScore)
      .sort((a, b) => b.compositeScore - a.compositeScore);

    return {
      categoryId,
      categoryName: (aiCategory as any).name,
      totalFellows: filtered.length,
      fellows: filtered,
    };
  }

  /**
   * POST /admin/microgrants/issue
   * Issue a financial mini-grant to one or more fellows.
   */
  async issueMicrogrants(
    adminId: string,
    payload: {
      studentIds: string[];
      amount: number;
      currency?: string;
      categoryId: string;
      notes?: string;
    },
  ) {
    const { studentIds, amount, currency = 'KES', categoryId, notes } = payload;

    if (!studentIds?.length) throw new BadRequestException('No students selected');
    if (!amount || amount <= 0) throw new BadRequestException('Amount must be positive');

    const results: Array<{ studentId: string; name: string; success: boolean; error?: string }> = [];

    for (const sid of studentIds) {
      try {
        const fellow = await this.userModel.findById(sid).select('firstName lastName email').lean();
        if (!fellow) throw new Error('Fellow not found');

        // Get fresh score snapshot
        const modules = await this.moduleModel
          .find({ categoryId: new Types.ObjectId(categoryId), isActive: { $ne: false } })
          .select('_id')
          .lean();
        const enrollments = await this.moduleEnrollmentModel
          .find({ studentId: new Types.ObjectId(sid), moduleId: { $in: modules.map((m) => m._id) } })
          .select('isCompleted finalAssessmentScore progress lastAccessedAt')
          .lean();
        const snapshot = this.scoreFellow(fellow, enrollments);

        await this.micrograntModel.create({
          studentId: new Types.ObjectId(sid),
          categoryId: new Types.ObjectId(categoryId),
          amount,
          currency,
          status: MicrograntStatus.ISSUED,
          criteriaSnapshot: snapshot,
          issuedBy: new Types.ObjectId(adminId),
          issuedAt: new Date(),
          notes,
        });

        // Notify the fellow
        const name = `${(fellow as any).firstName || ''} ${(fellow as any).lastName || ''}`.trim();
        this.emailService.sendCustomEmail(
          (fellow as any).email,
          'Congratulations — You Have Been Awarded a Mini-Grant!',
          `Dear ${(fellow as any).firstName || 'Fellow'},\n\nWe are pleased to inform you that you have been awarded a mini-grant of ${currency} ${amount.toLocaleString()} in recognition of your outstanding performance, engagement, and commitment to the ARIN Fellowship programme.\n\nKeep up the excellent work!\n\nARIN eLearning Team`,
        ).catch((e) => console.error('Mini-grant email failed:', e.message));

        results.push({ studentId: sid, name, success: true });
      } catch (err) {
        results.push({ studentId: sid, name: sid, success: false, error: (err as any)?.message });
      }
    }

    const issued = results.filter((r) => r.success).length;
    await this.logActivity(
      ActivityType.USER_UPDATED,
      `Mini-grant of ${currency} ${payload.amount} issued to ${issued} fellow(s)`,
      adminId,
      undefined,
      undefined,
      { amount, currency, studentIds, issued },
      'Award',
    );

    return { issued, failed: results.filter((r) => !r.success).length, results };
  }

  /**
   * GET /admin/microgrants/history
   * List all issued microgrants with fellow details.
   */
  async getMicrograntHistory(filters: { status?: string; page?: number; limit?: number } = {}) {
    const { status, page = 1, limit = 30 } = filters;
    const query: any = {};
    if (status) query.status = status;

    const [grants, total] = await Promise.all([
      this.micrograntModel
        .find(query)
        .populate('studentId', 'firstName lastName email fellowData')
        .populate('categoryId', 'name')
        .populate('issuedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.micrograntModel.countDocuments(query),
    ]);

    const formatted = grants.map((g: any) => ({
      _id: (g._id as any).toString(),
      student: {
        id: g.studentId?._id?.toString(),
        name: `${g.studentId?.firstName || ''} ${g.studentId?.lastName || ''}`.trim(),
        email: g.studentId?.email,
        cohort: g.studentId?.fellowData?.cohort || '—',
      },
      category: g.categoryId?.name || '—',
      amount: g.amount,
      currency: g.currency,
      status: g.status,
      criteriaSnapshot: g.criteriaSnapshot,
      issuedBy: g.issuedBy ? `${g.issuedBy.firstName} ${g.issuedBy.lastName}` : '—',
      issuedAt: g.issuedAt,
      notes: g.notes,
      createdAt: g.createdAt,
    }));

    return {
      grants: formatted,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: {
        total,
        totalAmount: grants.reduce((s, g: any) => s + (g.amount || 0), 0),
      },
    };
  }

  // ===================== TOP PERFORMERS =====================

  async getTopPerformers() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const [byCompletions, byScore, byStreak, recentStars, levelChampions] = await Promise.all([

      // 1. Leaderboard: most modules completed
      this.moduleEnrollmentModel.aggregate([
        {
          $group: {
            _id: '$studentId',
            completedModules: { $sum: { $cond: ['$isCompleted', 1, 0] } },
            totalEnrollments: { $sum: 1 },
            avgProgress: { $avg: '$progress' },
            avgScore: { $avg: { $ifNull: ['$finalAssessmentScore', 0] } },
            lastActive: { $max: '$lastAccessedAt' },
            certificatesEarned: { $sum: { $cond: [{ $eq: ['$certificateEarned', true] }, 1, 0] } },
          },
        },
        { $sort: { completedModules: -1, avgScore: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        {
          $project: {
            name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            email: '$user.email', country: '$user.country',
            cohort: '$user.fellowData.cohort',
            currentStreak: { $ifNull: ['$user.currentStreakDays', 0] },
            totalPoints: { $ifNull: ['$user.totalPoints', 0] },
            completedModules: 1, totalEnrollments: 1,
            avgProgress: { $round: ['$avgProgress', 1] },
            avgScore: { $round: ['$avgScore', 1] },
            lastActive: 1, certificatesEarned: 1,
          },
        },
      ]),

      // 2. Leaderboard: highest avg assessment score
      this.moduleEnrollmentModel.aggregate([
        { $match: { finalAssessmentAttempts: { $gt: 0 } } },
        {
          $group: {
            _id: '$studentId',
            avgScore: { $avg: '$finalAssessmentScore' },
            completedModules: { $sum: { $cond: ['$isCompleted', 1, 0] } },
            totalAttempts: { $sum: '$finalAssessmentAttempts' },
            lastActive: { $max: '$lastAccessedAt' },
          },
        },
        { $sort: { avgScore: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        {
          $project: {
            name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            email: '$user.email', country: '$user.country',
            cohort: '$user.fellowData.cohort',
            avgScore: { $round: ['$avgScore', 1] },
            completedModules: 1, totalAttempts: 1, lastActive: 1,
          },
        },
      ]),

      // 3. Leaderboard: longest current streak
      this.userModel.aggregate([
        { $match: { role: UserRole.STUDENT, currentStreakDays: { $gt: 0 } } },
        { $sort: { currentStreakDays: -1, longestStreakDays: -1 } },
        { $limit: 10 },
        {
          $project: {
            name: { $concat: ['$firstName', ' ', '$lastName'] },
            email: 1, country: 1, cohort: '$fellowData.cohort',
            currentStreak: '$currentStreakDays',
            longestStreak: '$longestStreakDays',
            totalPoints: { $ifNull: ['$totalPoints', 0] },
          },
        },
      ]),

      // 4. Recent stars: active last 7 days with ≥50% progress
      this.moduleEnrollmentModel.aggregate([
        { $match: { lastAccessedAt: { $gte: sevenDaysAgo }, progress: { $gte: 50 } } },
        {
          $group: {
            _id: '$studentId',
            completedModules: { $sum: { $cond: ['$isCompleted', 1, 0] } },
            avgProgress: { $avg: '$progress' },
            lastActive: { $max: '$lastAccessedAt' },
          },
        },
        { $sort: { completedModules: -1, avgProgress: -1 } },
        { $limit: 8 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        {
          $project: {
            name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            email: '$user.email', country: '$user.country',
            cohort: '$user.fellowData.cohort',
            completedModules: 1,
            avgProgress: { $round: ['$avgProgress', 1] },
            lastActive: 1,
          },
        },
      ]),

      // 5. Level champions — top student per level
      this.moduleEnrollmentModel.aggregate([
        { $lookup: { from: 'modules', localField: 'moduleId', foreignField: '_id', as: 'module' } },
        { $unwind: { path: '$module', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: { studentId: '$studentId', level: '$module.level' },
            completedModules: { $sum: { $cond: ['$isCompleted', 1, 0] } },
            avgScore: { $avg: { $ifNull: ['$finalAssessmentScore', 0] } },
          },
        },
        { $sort: { '_id.level': 1, completedModules: -1, avgScore: -1 } },
        {
          $group: {
            _id: '$_id.level',
            topStudentId: { $first: '$_id.studentId' },
            completedModules: { $first: '$completedModules' },
            avgScore: { $first: '$avgScore' },
          },
        },
        { $lookup: { from: 'users', localField: 'topStudentId', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        {
          $project: {
            level: '$_id',
            name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            email: '$user.email', country: '$user.country',
            completedModules: 1,
            avgScore: { $round: ['$avgScore', 1] },
          },
        },
        { $sort: { level: 1 } },
      ]),
    ]);

    return { byCompletions, byScore, byStreak, recentStars, levelChampions };
  }

  // ===================== DEBUG =====================

  async getDebugCounts() {
    const db = this.userModel.db;

    // ── List ALL collection names in the database ────────────────────────────
    const allCollections = (await db.listCollections()).map((c: any) => c.name).sort();

    // ── Count documents in every relevant collection ─────────────────────────
    const counts: Record<string, number> = {};
    for (const name of allCollections) {
      try { counts[name] = await db.collection(name).countDocuments(); }
      catch { counts[name] = -1; }
    }

    // ── Sample enrollment + module ───────────────────────────────────────────
    const sampleEnrollment = await this.moduleEnrollmentModel
      .findOne()
      .select('moduleId studentId progress isCompleted certificateEarned finalAssessmentScore')
      .lean();

    const moduleSample = await this.moduleModel
      .findOne()
      .select('_id title level status avgRating totalRatings')
      .lean();

    // ── Certificates: check both collection and enrollment flag ──────────────
    const [certsInCollection, enrollmentsWithCertFlag, enrollmentsProgress100, enrollmentsCompleted] = await Promise.all([
      this.moduleCertificateModel.countDocuments(),
      this.moduleEnrollmentModel.countDocuments({ certificateEarned: true }),
      this.moduleEnrollmentModel.countDocuments({ progress: 100 }),
      this.moduleEnrollmentModel.countDocuments({ isCompleted: true }),
    ]);

    // Sample a certificate if any
    const sampleCert = await this.moduleCertificateModel.findOne().lean().catch(() => null);

    // ── Ratings: check via module and try collection directly ────────────────
    const modulesWithRatings = await this.moduleModel.countDocuments({ totalRatings: { $gt: 0 } });
    let ratingsCollectionCount = 0;
    let sampleRating: any = null;
    try {
      // try common collection name variants
      for (const name of ['moduleratings', 'module_ratings', 'moduleRatings']) {
        if (allCollections.includes(name)) {
          ratingsCollectionCount = await db.collection(name).countDocuments();
          sampleRating = await db.collection(name).findOne({});
          break;
        }
      }
    } catch { /* ignore */ }

    const report = {
      allCollections,
      collectionCounts: counts,
      certificates: {
        inModuleCertificateCollection: certsInCollection,
        enrollmentsWithCertificateEarnedTrue: enrollmentsWithCertFlag,
        enrollmentsWithProgress100: enrollmentsProgress100,
        enrollmentsWithIsCompletedTrue: enrollmentsCompleted,
        sampleCert,
      },
      ratings: {
        modulesWithTotalRatingsGt0: modulesWithRatings,
        ratingsCollectionCount,
        sampleRating,
      },
      sampleEnrollment,
      moduleSample,
    };

    console.log('\n=== FULL DEBUG REPORT ===');
    console.log('Collections:', allCollections.join(', '));
    console.log('Cert in collection:', certsInCollection);
    console.log('Cert flag on enrollment:', enrollmentsWithCertFlag);
    console.log('Progress=100 enrollments:', enrollmentsProgress100);
    console.log('isCompleted=true enrollments:', enrollmentsCompleted);
    console.log('Modules with ratings:', modulesWithRatings);
    console.log('Ratings collection count:', ratingsCollectionCount);
    console.log('Sample enrollment:', JSON.stringify(sampleEnrollment, null, 2));
    console.log('=========================\n');

    return report;
  }

  // ===================== EXTENDED ANALYTICS =====================

  async getExtendedAnalytics() {
    try {
    const now = new Date();
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // ── 1. Students per level (based on module enrollments) ─────────────────
    const levelEnrollmentRaw = await this.moduleEnrollmentModel.aggregate([
      {
        $lookup: {
          from: 'modules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module',
        },
      },
      { $unwind: '$module' },
      {
        $group: {
          _id: '$module.level',
          totalStudents: { $addToSet: '$studentId' },
          totalEnrollments: { $sum: 1 },
          completedEnrollments: { $sum: { $cond: [{ $or: [{ $eq: ['$isCompleted', true] }, { $gte: ['$progress', 100] }] }, 1, 0] } },
          avgProgress: { $avg: '$progress' },
        },
      },
      {
        $project: {
          level: '$_id',
          totalStudents: { $size: '$totalStudents' },
          totalEnrollments: 1,
          completedEnrollments: 1,
          avgProgress: { $round: ['$avgProgress', 1] },
          completionRate: {
            $cond: [
              { $gt: ['$totalEnrollments', 0] },
              { $round: [{ $multiply: [{ $divide: ['$completedEnrollments', '$totalEnrollments'] }, 100] }, 1] },
              0,
            ],
          },
        },
      },
    ]);

    const levelOrder = ['beginner', 'intermediate', 'advanced'];
    const levelStats = levelOrder.map((lvl) => {
      const found = levelEnrollmentRaw.find((r: any) => r.level === lvl);
      return {
        level: lvl,
        label: lvl === 'beginner' ? 'Basic' : lvl === 'intermediate' ? 'Intermediate' : 'Advanced',
        totalStudents: found?.totalStudents ?? 0,
        totalEnrollments: found?.totalEnrollments ?? 0,
        completedEnrollments: found?.completedEnrollments ?? 0,
        avgProgress: found?.avgProgress ?? 0,
        completionRate: found?.completionRate ?? 0,
      };
    });

    // ── 2. Module progress stats (per module breakdown) ──────────────────────
    const moduleProgressRaw = await this.moduleEnrollmentModel.aggregate([
      {
        $group: {
          _id: '$moduleId',
          totalEnrollments: { $sum: 1 },
          completedCount: { $sum: { $cond: [{ $or: [{ $eq: ['$isCompleted', true] }, { $gte: ['$progress', 100] }] }, 1, 0] } },
          avgProgress: { $avg: '$progress' },
          repeatCount: { $sum: { $cond: [{ $gt: ['$moduleRepeatCount', 0] }, 1, 0] } },
          pendingGrading: { $sum: { $ifNull: ['$pendingManualGradingCount', 0] } },
        },
      },
      {
        $lookup: {
          from: 'modules',
          localField: '_id',
          foreignField: '_id',
          as: 'module',
        },
      },
      { $unwind: { path: '$module', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          moduleId: '$_id',
          title: '$module.title',
          level: '$module.level',
          status: '$module.status',
          avgRating: { $ifNull: ['$module.avgRating', 0] },
          totalRatings: { $ifNull: ['$module.totalRatings', 0] },
          totalEnrollments: 1,
          completedCount: 1,
          avgProgress: { $round: ['$avgProgress', 1] },
          repeatCount: 1,
          pendingGrading: 1,
          completionRate: {
            $cond: [
              { $gt: ['$totalEnrollments', 0] },
              { $round: [{ $multiply: [{ $divide: ['$completedCount', '$totalEnrollments'] }, 100] }, 1] },
              0,
            ],
          },
        },
      },
      { $sort: { totalEnrollments: -1 } },
    ]);

    // ── 3. Certificate stats ─────────────────────────────────────────────────
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [certsFromCollection, certsFromEnrollment, certMonthlyRaw] = await Promise.all([
      this.moduleCertificateModel.countDocuments(),
      this.moduleEnrollmentModel.countDocuments({ certificateEarned: true }),
      this.moduleCertificateModel.aggregate([
        { $match: { issuedDate: { $gte: twelveMonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: '$issuedDate' }, month: { $month: '$issuedDate' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    // Use whichever count is higher (collection vs enrollment flag)
    const totalCertsIssued = Math.max(certsFromCollection, certsFromEnrollment);
    // Count completions using both flag and progress (some records use progress:100 without setting flag)
    const totalCompleted = await this.moduleEnrollmentModel.countDocuments({
      $or: [{ isCompleted: true }, { progress: { $gte: 100 } }],
    });
    const certIssuanceRate = totalCompleted > 0 ? +((totalCertsIssued / totalCompleted) * 100).toFixed(1) : 0;

    const certMonthlyTrend = certMonthlyRaw.map((c: any) => ({
      label: `${MONTHS[c._id.month - 1]} ${c._id.year}`,
      month: MONTHS[c._id.month - 1],
      count: c.count,
    }));

    // ── 4. Module ratings analytics ──────────────────────────────────────────
    let ratedModules: any[] = [];
    let unratedModulesCount = 0;
    let overallAvgRating = 0;

    try {
      // Try querying ModuleRating collection directly (same connection)
      const moduleRatingCollection = this.userModel.db.collection('moduleratings');
      const ratingsPerModule = await moduleRatingCollection.aggregate([
        { $group: { _id: '$moduleId', avgRating: { $avg: '$rating' }, totalRatings: { $sum: 1 } } },
      ]).toArray();

      const ratingMap = new Map(
        ratingsPerModule.map((r: any) => [r._id?.toString(), { avgRating: +(r.avgRating || 0).toFixed(1), totalRatings: r.totalRatings as number }]),
      );

      const publishedModules = await this.moduleModel
        .find({ status: 'published' })
        .select('_id title level enrollmentCount avgRating totalRatings')
        .lean();

      const modulesWithRatings = publishedModules.map((m: any) => {
        const id = (m._id as any).toString();
        const fromCollection = ratingMap.get(id);
        return {
          ...m,
          avgRating: fromCollection?.avgRating ?? (m.avgRating || 0),
          totalRatings: fromCollection?.totalRatings ?? (m.totalRatings || 0),
        };
      });

      ratedModules = modulesWithRatings.filter((m: any) => m.totalRatings > 0).sort((a: any, b: any) => b.avgRating - a.avgRating);
      unratedModulesCount = modulesWithRatings.filter((m: any) => m.totalRatings === 0).length;
      overallAvgRating = ratedModules.length > 0
        ? +(ratedModules.reduce((s: number, m: any) => s + (m.avgRating || 0), 0) / ratedModules.length).toFixed(1)
        : 0;
    } catch (err) {
      console.warn('Ratings query failed, using module denormalized fields:', (err as any).message);
      // Fallback: use denormalized avgRating on module documents
      const fallbackModules = await this.moduleModel
        .find({ status: 'published' })
        .select('_id title level enrollmentCount avgRating totalRatings')
        .lean();
      ratedModules = (fallbackModules as any[]).filter((m: any) => (m.totalRatings || 0) > 0).sort((a: any, b: any) => b.avgRating - a.avgRating);
      unratedModulesCount = (fallbackModules as any[]).filter((m: any) => !(m.totalRatings > 0)).length;
      overallAvgRating = ratedModules.length > 0
        ? +(ratedModules.reduce((s: number, m: any) => s + (m.avgRating || 0), 0) / ratedModules.length).toFixed(1)
        : 0;
    }

    // ── 5. Student streak & XP stats ────────────────────────────────────────
    const streakStats = await this.userModel.aggregate([
      { $match: { role: UserRole.STUDENT } },
      {
        $group: {
          _id: null,
          avgCurrentStreak: { $avg: { $ifNull: ['$currentStreakDays', 0] } },
          maxCurrentStreak: { $max: { $ifNull: ['$currentStreakDays', 0] } },
          maxLongestStreak: { $max: { $ifNull: ['$longestStreakDays', 0] } },
          totalXP: { $sum: { $ifNull: ['$totalPoints', 0] } },
          studentsWithStreak: {
            $sum: { $cond: [{ $gt: [{ $ifNull: ['$currentStreakDays', 0] }, 0] }, 1, 0] },
          },
        },
      },
    ]);

    const streak = streakStats[0] ?? {
      avgCurrentStreak: 0,
      maxCurrentStreak: 0,
      maxLongestStreak: 0,
      totalXP: 0,
      studentsWithStreak: 0,
    };

    // ── 6. Instructor pending grading queue ──────────────────────────────────
    const pendingGradingTotal = await this.moduleEnrollmentModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$pendingManualGradingCount', 0] } },
        },
      },
    ]);
    const totalPendingGrading = pendingGradingTotal[0]?.total ?? 0;

    // Instructor leaderboard (modules + students taught)
    const instructors = await this.userModel
      .find({ role: UserRole.INSTRUCTOR })
      .select('firstName lastName email lastLogin')
      .lean();

    const instructorLeaderboard = await Promise.all(
      instructors.slice(0, 20).map(async (inst) => {
        const modules = await this.moduleModel
          .find({ instructorIds: inst._id, status: 'published' })
          .select('title enrollmentCount completionRate avgRating')
          .lean();
        const studentsTaught = modules.reduce((s: number, m: any) => s + (m.enrollmentCount || 0), 0);
        const avgScore =
          modules.length > 0
            ? +(modules.reduce((s: number, m: any) => s + (m.completionRate || 0), 0) / modules.length).toFixed(1)
            : 0;
        return {
          name: `${inst.firstName} ${inst.lastName}`,
          email: inst.email,
          publishedModules: modules.length,
          studentsTaught,
          avgCompletionRate: avgScore,
          lastLogin: inst.lastLogin,
        };
      }),
    );
    instructorLeaderboard.sort((a, b) => b.studentsTaught - a.studentsTaught);

    return {
      levelStats,
      moduleProgressStats: moduleProgressRaw,
      certificates: {
        totalIssued: totalCertsIssued,
        issuanceRate: certIssuanceRate,
        monthlyTrend: certMonthlyTrend,
        totalCompletions: totalCompleted,
      },
      ratings: {
        overallAvgRating,
        ratedModulesCount: ratedModules.length,
        unratedModulesCount: unratedModulesCount,
        topRated: ratedModules.slice(0, 8),
        bottomRated: [...ratedModules].reverse().slice(0, 5),
      },
      streaks: {
        avgCurrentStreak: +streak.avgCurrentStreak.toFixed(1),
        maxCurrentStreak: streak.maxCurrentStreak,
        maxLongestStreak: streak.maxLongestStreak,
        totalXP: streak.totalXP,
        studentsWithStreak: streak.studentsWithStreak,
      },
      grading: {
        totalPendingGrading,
        instructorLeaderboard,
      },
    };
    } catch (err) {
      console.error('getExtendedAnalytics error:', (err as any).message);
      return {
        levelStats: [], moduleProgressStats: [],
        certificates: { totalIssued: 0, issuanceRate: 0, monthlyTrend: [], totalCompletions: 0 },
        ratings: { overallAvgRating: 0, ratedModulesCount: 0, unratedModulesCount: 0, topRated: [], bottomRated: [] },
        streaks: { avgCurrentStreak: 0, maxCurrentStreak: 0, maxLongestStreak: 0, totalXP: 0, studentsWithStreak: 0 },
        grading: { totalPendingGrading: 0, instructorLeaderboard: [] },
      };
    }
  }
}
