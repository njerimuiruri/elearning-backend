import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Course } from '../schemas/course.schema';
import { Enrollment } from '../schemas/enrollment.schema';
import { Progress } from '../schemas/progress.schema';
import { Certificate } from '../schemas/certificate.schema';
import { Discussion } from '../schemas/discussion.schema';
import { EmailReminder } from '../schemas/email-reminder.schema';
import { User } from '../schemas/user.schema';

@Injectable()
export class CourseService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    @InjectModel(Certificate.name) private certificateModel: Model<Certificate>,
    @InjectModel(Discussion.name) private discussionModel: Model<Discussion>,
    @InjectModel(EmailReminder.name) private emailReminderModel: Model<EmailReminder>,
  ) {}

  // Course Management
  async createCourse(instructorId: string, courseData: any) {
    const newCourse = new this.courseModel({
      ...courseData,
      instructorId,
    });
    return await newCourse.save();
  }

  async getCourseById(courseId: string) {
    return await this.courseModel
      .findById(courseId)
      .populate('instructorId', 'firstName lastName email institution avgRating')
      .lean();
  }

  async getInstructorCourses(instructorId: string) {
    return await this.courseModel
      .find({ instructorId })
      .sort({ createdAt: -1 })
      .lean();
  }

  async getAllPublishedCourses(filters: { category?: string; level?: string; page?: number; limit?: number } = {}) {
    const { category, level, page = 1, limit = 20 } = filters;
    const query: any = { status: 'published', isActive: true };

    if (category) query.category = category;
    if (level) query.level = level;

    const skip = (page - 1) * limit;

    const [courses, total] = await Promise.all([
      this.courseModel
        .find(query)
        .populate('instructorId', 'firstName lastName email avgRating totalStudents')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.courseModel.countDocuments(query),
    ]);

    return {
      courses,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async updateCourse(courseId: string, courseData: any) {
    return await this.courseModel.findByIdAndUpdate(courseId, courseData, {
      new: true,
      runValidators: true,
    });
  }

  async deleteCourse(courseId: string) {
    return await this.courseModel.findByIdAndDelete(courseId);
  }

  // Course Submission & Approval
  async submitCourse(courseId: string) {
    return await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'submitted',
        submittedAt: new Date(),
      },
      { new: true },
    );
  }

  async approveCourse(courseId: string, adminId: string, feedback?: string) {
    return await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'approved',
        approvedBy: adminId,
        approvedAt: new Date(),
      },
      { new: true },
    );
  }

  async rejectCourse(courseId: string, reason: string) {
    return await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'rejected',
        rejectionReason: reason,
      },
      { new: true },
    );
  }

  async publishCourse(courseId: string) {
    return await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'published',
        publishedAt: new Date(),
      },
      { new: true },
    );
  }

  // Enrollment Management
  async enrollStudent(studentId: string, courseId: string) {
    const existingEnrollment = await this.enrollmentModel.findOne({
      studentId,
      courseId,
    });

    if (existingEnrollment) {
      throw new Error('Student is already enrolled in this course');
    }

    const enrollment = new this.enrollmentModel({
      studentId,
      courseId,
      lastAccessedAt: new Date(),
    });

    await enrollment.save();

    // Create progress records for each module
    const course = await this.courseModel.findById(courseId);
    if (course && course.modules) {
      const progressRecords = course.modules.map((_, index) => ({
        studentId,
        courseId,
        enrollmentId: enrollment._id,
        moduleIndex: index,
      }));
      await this.progressModel.insertMany(progressRecords);
    }

    // Create email reminder
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.emailReminderModel.create({
      studentId,
      courseId,
      enrollmentId: enrollment._id,
      reminderType: 'weekly',
      nextReminderDate: nextWeek,
    });

    return enrollment;
  }

  async getStudentEnrollments(studentId: string) {
    return await this.enrollmentModel
      .find({ studentId })
      .populate('courseId', 'title category level status')
      .sort({ createdAt: -1 })
      .lean();
  }

  async getEnrollmentById(enrollmentId: string) {
    return await this.enrollmentModel
      .findById(enrollmentId)
      .populate('courseId')
      .populate('studentId', 'firstName lastName email')
      .lean();
  }

  // Progress Tracking
  async updateProgress(enrollmentId: string, moduleIndex: number, score: number, answers: any[]) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) throw new Error('Enrollment not found');

    const progressRecord = await this.progressModel.findOne({
      enrollmentId,
      moduleIndex,
    });

    if (progressRecord) {
      progressRecord.moduleScore = score;
      progressRecord.questionAnswers = answers;
      progressRecord.moduleCompleted = true;
      progressRecord.completedAt = new Date();
      await progressRecord.save();
    }

    // Calculate overall progress
    const totalProgress = await this.progressModel.find({ enrollmentId });
    const completedModules = totalProgress.filter((p) => p.moduleCompleted).length;
    const totalScore = totalProgress.reduce((sum, p) => sum + (p.moduleScore || 0), 0);

    const course = await this.courseModel.findById(enrollment.courseId);
    const progressPercentage = course?.modules ? (completedModules / course.modules.length) * 100 : 0;

    await this.enrollmentModel.findByIdAndUpdate(enrollmentId, {
      progress: progressPercentage,
      completedModules,
      totalScore,
      lastAccessedAt: new Date(),
      isCompleted: completedModules === course?.modules?.length,
      completedAt: completedModules === course?.modules?.length ? new Date() : null,
    });

    return {
      progress: progressPercentage,
      score: totalScore,
      isCompleted: completedModules === course?.modules?.length,
    };
  }

  async getEnrollmentProgress(enrollmentId: string) {
    return await this.progressModel.find({ enrollmentId }).lean();
  }

  // Certificate Management
  async generateCertificate(enrollmentId: string, studentId: string, courseId: string) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    const course = await this.courseModel.findById(courseId);
    const student = await this.userModel.findById(studentId);

    if (!enrollment || !course || !student) {
      throw new Error('Enrollment, Course or Student not found');
    }

    const certificateNumber = `CERT-${Date.now()}-${studentId.slice(-4)}`;

    const certificate = new this.certificateModel({
      studentId,
      courseId,
      enrollmentId,
      certificateNumber,
      issuedDate: new Date(),
      studentName: `${student?.firstName || ''} ${student?.lastName || ''}`,
      courseName: course.title,
      scoreAchieved: enrollment.totalScore,
      instructorName: `Instructor`, // Can be populated from user lookup if needed
    });

    await certificate.save();

    // Update enrollment
    await this.enrollmentModel.findByIdAndUpdate(enrollmentId, {
      certificateId: certificate._id,
      certificateEarned: true,
    });

    return certificate;
  }

  async getStudentCertificates(studentId: string) {
    return await this.certificateModel
      .find({ studentId })
      .populate('courseId', 'title')
      .sort({ issuedDate: -1 })
      .lean();
  }

  // Discussion Management
  async createDiscussion(discussionData: any) {
    const discussion = new this.discussionModel(discussionData);
    return await discussion.save();
  }

  async getCoursesDiscussions(courseId: string) {
    return await this.discussionModel
      .find({ courseId })
      .populate('studentId', 'firstName lastName')
      .populate('instructorId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();
  }

  async addDiscussionReply(discussionId: string, reply: any) {
    return await this.discussionModel.findByIdAndUpdate(
      discussionId,
      {
        $push: { replies: reply },
      },
      { new: true },
    );
  }

  async resolveDiscussion(discussionId: string) {
    return await this.discussionModel.findByIdAndUpdate(
      discussionId,
      { isResolved: true, status: 'resolved' },
      { new: true },
    );
  }

  // Dashboard Statistics
  async getInstructorDashboard(instructorId: string) {
    const courses = await this.courseModel.find({ instructorId });
    const courseIds = courses.map((c) => c._id);

    const [totalEnrollments, totalCourses, totalStudents, averageRating] = await Promise.all([
      this.enrollmentModel.countDocuments({ courseId: { $in: courseIds } }),
      this.courseModel.countDocuments({ instructorId, status: 'published' }),
      this.enrollmentModel.distinct('studentId', { courseId: { $in: courseIds } }).then((ids) => ids.length),
      this.userModel.findById(instructorId).select('avgRating'),
    ]);

    const completedCourses = await this.enrollmentModel.countDocuments({
      courseId: { $in: courseIds },
      isCompleted: true,
    });

    return {
      totalCourses,
      totalEnrollments,
      totalStudents,
      completedEnrollments: completedCourses,
      averageRating: averageRating?.avgRating || 0,
    };
  }

  async getStudentDashboard(studentId: string) {
    const enrollments = await this.enrollmentModel.find({ studentId });
    const certificates = await this.certificateModel.countDocuments({ studentId });

    const totalProgress = enrollments.reduce((sum, e) => sum + (e.progress || 0), 0);
    const avgProgress = enrollments.length > 0 ? totalProgress / enrollments.length : 0;

    return {
      totalEnrollments: enrollments.length,
      completedCourses: enrollments.filter((e) => e.isCompleted).length,
      inProgressCourses: enrollments.filter((e) => !e.isCompleted).length,
      certificates,
      averageProgress: Math.round(avgProgress),
      enrollments: enrollments
        .map((e) => ({
          ...e.toObject(),
          progressPercentage: e.progress,
        }))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    };
  }
}
