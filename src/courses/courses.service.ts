import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Course } from '../schemas/course.schema';
import { Enrollment } from '../schemas/enrollment.schema';
import { Progress } from '../schemas/progress.schema';
import { Certificate } from '../schemas/certificate.schema';
import { Discussion } from '../schemas/discussion.schema';
import { EmailReminder } from '../schemas/email-reminder.schema';
import { User } from '../schemas/user.schema';
import { EmailService } from '../common/services/email.service';
import { InstructorReview } from '../schemas/instructor-review.schema';

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
    @InjectModel(InstructorReview.name) private instructorReviewModel: Model<InstructorReview>,
    private emailService: EmailService,
  ) {}

  // Course Management
  async createCourse(instructorId: string, courseData: any) {
    const normalized = this.normalizeCourseData(courseData);
    const newCourse = new this.courseModel({
      ...normalized,
      instructorId,
    });
    return await newCourse.save();
  }

  async assignInstructorToCourse(courseId: string, instructorId: string) {
    console.log('Assigning instructor to course:', { courseId, instructorId });
    const updated = await this.courseModel.findByIdAndUpdate(
      courseId,
      { instructorId: instructorId as any },
      { new: true },
    );
    if (updated) {
      console.log('Course updated:', updated._id);
    }
    return updated;
  }

  async getCourseById(courseId: string) {
    // Guard against invalid ObjectId inputs (e.g., numeric indices like "1")
    if (!Types.ObjectId.isValid(courseId)) {
      return null;
    }

    return await this.courseModel
      .findById(courseId)
      .populate('instructorId', 'firstName lastName email institution avgRating profilePhotoUrl bio')
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

  private normalizeCourseData(courseData: any) {
    if (!courseData) return courseData;

    const normalizeQuestion = (question: any) => {
      if (!question) return question;
      // Allow "question" field from frontend and map to schema "text"
      if (!question.text && question.question) {
        question.text = question.question;
      }
      return question;
    };

    const normalizeAssessment = (assessment: any) => {
      if (!assessment) return assessment;
      if (Array.isArray(assessment.questions)) {
        assessment.questions = assessment.questions.map(normalizeQuestion);
      }
      return assessment;
    };

    if (Array.isArray(courseData.modules)) {
      courseData.modules = courseData.modules.map((module: any) => {
        if (Array.isArray(module.questions)) {
          module.questions = module.questions.map(normalizeQuestion);
        }
        if (module.moduleAssessment) {
          module.moduleAssessment = normalizeAssessment(module.moduleAssessment);
        }
        return module;
      });
    }

    if (courseData.finalAssessment) {
      courseData.finalAssessment = normalizeAssessment(courseData.finalAssessment);
    }

    return courseData;
  }

  private async buildModuleProgress(enrollmentId: Types.ObjectId | string, totalModules?: number) {
    const enrollmentObjectId = typeof enrollmentId === 'string' ? new Types.ObjectId(enrollmentId) : enrollmentId;

    // Start with persisted moduleProgress from enrollment (authoritative for assessmentPassed)
    const enrollmentDoc = await this.enrollmentModel.findById(enrollmentObjectId).lean();
    const existing = enrollmentDoc?.moduleProgress || [];
    const moduleMap = new Map<number, any>();

    existing.forEach((mp: any) => {
      moduleMap.set(mp.moduleIndex, {
        moduleIndex: mp.moduleIndex,
        isCompleted: !!mp.isCompleted,
        assessmentPassed: !!mp.assessmentPassed,
        assessmentAttempts: mp.assessmentAttempts ?? 0,
        lastScore: mp.lastScore ?? 0,
        completedAt: mp.completedAt || null,
      });
    });

    // Overlay any legacy progress records (keeps completion data if present)
    const progressRecords = await this.progressModel.find({ enrollmentId: enrollmentObjectId }).lean();
    progressRecords.forEach((record) => {
      const current = moduleMap.get(record.moduleIndex) || { moduleIndex: record.moduleIndex };
      moduleMap.set(record.moduleIndex, {
        moduleIndex: record.moduleIndex,
        isCompleted: current.isCompleted || !!record.moduleCompleted,
        assessmentPassed: current.assessmentPassed || !!record.moduleCompleted,
        assessmentAttempts: current.assessmentAttempts ?? (record.moduleCompleted ? 1 : 0),
        lastScore: current.lastScore ?? (record.moduleScore || 0),
        completedAt: current.completedAt || record.completedAt || null,
      });
    });

    if (typeof totalModules === 'number' && totalModules > 0) {
      for (let i = 0; i < totalModules; i++) {
        if (!moduleMap.has(i)) {
          moduleMap.set(i, {
            moduleIndex: i,
            isCompleted: false,
            assessmentPassed: false,
            assessmentAttempts: 0,
            lastScore: 0,
            completedAt: null,
          });
        }
      }
    }

    return Array.from(moduleMap.values()).sort((a, b) => a.moduleIndex - b.moduleIndex);
  }

  private async updateEnrollment(enrollmentId: Types.ObjectId | string, update: any) {
    const id = typeof enrollmentId === 'string' ? enrollmentId : enrollmentId.toString();
    return this.enrollmentModel.findByIdAndUpdate(
      id,
      update,
      { new: true }
    );
  }

  async updateCourse(courseId: string, courseData: any) {
    const normalized = this.normalizeCourseData(courseData);
    return await this.courseModel.findByIdAndUpdate(courseId, normalized, {
      new: true,
      runValidators: true,
    });
  }

  async deleteCourse(courseId: string) {
    return await this.courseModel.findByIdAndDelete(courseId);
  }

  // Course Submission & Approval
  async submitCourse(courseId: string, instructorId?: string) {
    // First, get the course
    const course = await this.courseModel.findById(courseId);
    
    if (!course) {
      throw new Error('Course not found');
    }
    
    // If course has no instructor and we have one provided, assign it
    if (!course.instructorId && instructorId) {
      course.instructorId = instructorId as any;
      await course.save();
    }

    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'submitted',
        submittedAt: new Date(),
      },
      { new: true },
    ).populate('instructorId');

    if (!updatedCourse) {
      throw new Error('Course not found');
    }

    // Send notification email to admin
    try {
      const instructorData = updatedCourse.instructorId as any;
      await this.emailService.sendCourseSubmissionNotificationToAdmin(
        'faith.muiruri@strathmore.edu',
        `${instructorData.firstName} ${instructorData.lastName}`,
        instructorData.email,
        updatedCourse.title,
        updatedCourse.category,
        updatedCourse.description,
        updatedCourse.modules?.length || 0,
        updatedCourse._id.toString(),
      );
    } catch (error) {
      console.error('Failed to send course submission email to admin:', error);
      // Don't fail the submission if email fails
    }

    return updatedCourse;
  }

  async approveCourse(courseId: string, adminId: string, feedback?: string) {
    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'published', // Automatically publish course when approved
        approvedBy: adminId,
        approvedAt: new Date(),
        publishedAt: new Date(),
      },
      { new: true },
    ).populate('instructorId');

    if (!updatedCourse) {
      throw new Error('Course not found');
    }

    // Send approval email to instructor
    try {
      const instructor = updatedCourse.instructorId as any;
      await this.emailService.sendCourseApprovedEmail(
        instructor.email,
        `${instructor.firstName} ${instructor.lastName}`,
        updatedCourse.title,
      );
    } catch (error) {
      console.error('Failed to send course approval email to instructor:', error);
      // Don't fail the approval if email fails
    }

    return updatedCourse;
  }

  async rejectCourse(courseId: string, reason: string) {
    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        status: 'rejected',
        rejectionReason: reason,
      },
      { new: true },
    ).populate('instructorId');

    if (!updatedCourse) {
      throw new Error('Course not found');
    }

    // Send rejection email to instructor
    try {
      const instructor = updatedCourse.instructorId as any;
      await this.emailService.sendCourseRejectedEmail(
        instructor.email,
        `${instructor.firstName} ${instructor.lastName}`,
        updatedCourse.title,
        reason,
      );
    } catch (error) {
      console.error('Failed to send course rejection email to instructor:', error);
      // Don't fail the rejection if email fails
    }

    return updatedCourse;
  }


  // Instructor Reviews
  async addInstructorReview(studentId: string, courseId: string, rating: number, comment: string) {
    const course = await this.courseModel.findById(courseId);
    if (!course) {
      throw new Error('Course not found');
    }

    // Ensure the student is enrolled (optionally completed)
    const enrollment = await this.enrollmentModel.findOne({
      studentId: new Types.ObjectId(studentId),
      courseId: new Types.ObjectId(courseId),
    });
    if (!enrollment) {
      throw new Error('You must be enrolled in this course to review the instructor');
    }

    const review = await this.instructorReviewModel.findOneAndUpdate(
      {
        instructorId: course.instructorId,
        studentId,
        courseId,
      },
      {
        rating,
        comment,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await this.updateInstructorStats(course.instructorId);
    return review;
  }

  async getInstructorReviews(instructorId: string) {
    return this.instructorReviewModel
      .find({ instructorId })
      .populate('studentId', 'firstName lastName email')
      .populate('courseId', 'title')
      .sort({ createdAt: -1 })
      .lean();
  }

  private async updateInstructorStats(instructorId: Types.ObjectId | string) {
    const instructorObjectId = new Types.ObjectId(instructorId);
    const stats = await this.instructorReviewModel.aggregate([
      { $match: { instructorId: instructorObjectId } },
      {
        $group: {
          _id: '$instructorId',
          avgRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 },
        },
      },
    ]);

    const avgRating = stats[0]?.avgRating || 0;
    const reviewCount = stats[0]?.reviewCount || 0;

    // Estimate total students taught from enrollments across instructor's courses
    const courseIds = await this.courseModel.find({ instructorId: instructorObjectId }).distinct('_id');
    const totalStudents = courseIds.length
      ? await this.enrollmentModel.distinct('studentId', { courseId: { $in: courseIds } }).then((ids) => ids.length)
      : 0;

    await this.userModel.findByIdAndUpdate(instructorId, {
      avgRating,
      totalStudents,
    });

    return { avgRating, totalStudents, reviewCount };
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
    const course = await this.courseModel.findById(courseId);
    if (!course) {
      throw new Error('Course not found');
    }
    if (course.status !== 'published') {
      throw new Error('Course is not published');
    }

    const existingEnrollment = await this.enrollmentModel.findOne({
      studentId,
      courseId,
    });

    if (existingEnrollment) {
      const moduleProgress = await this.buildModuleProgress(existingEnrollment._id, course.modules?.length || 0);
      const updated = await this.updateEnrollment(existingEnrollment._id, {
        moduleProgress: moduleProgress as any,
        lastAccessedAt: new Date(),
      });
      return updated;
    }

    const enrollment = new this.enrollmentModel({
      studentId,
      courseId,
      lastAccessedAt: new Date(),
    });

    try {
      await enrollment.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        const dup = await this.enrollmentModel.findOne({ studentId, courseId });
        if (dup) {
          const moduleProgress = await this.buildModuleProgress(dup._id, course.modules?.length || 0);
          const updated = await this.updateEnrollment(dup._id, {
            moduleProgress: moduleProgress as any,
            lastAccessedAt: new Date(),
          });
          return updated;
        }
      }
      throw err;
    }

    // Create progress records for each module
    if (course.modules && course.modules.length) {
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

    // Increment enrollment count for the course
    await this.courseModel.findByIdAndUpdate(courseId, {
      $inc: { enrollmentCount: 1 },
    });

    const moduleProgress = await this.buildModuleProgress(enrollment._id, course.modules?.length || 0);
    const updated = await this.updateEnrollment(enrollment._id, { moduleProgress: moduleProgress as any });

    return updated || enrollment;
  }

  async getEnrollmentForCourse(studentId: string, courseId: string) {
    const enrollment = await this.enrollmentModel.findOne({ studentId, courseId });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const course = await this.courseModel.findById(courseId);
    const moduleProgress = await this.buildModuleProgress(enrollment._id, course?.modules?.length || 0);
    const updated = await this.updateEnrollment(enrollment._id, {
      moduleProgress: moduleProgress as any,
      lastAccessedAt: new Date(),
    });

    return updated;
  }

  async getStudentEnrollments(studentId: string) {
    return await this.enrollmentModel
      .find({ studentId })
      .populate('courseId', 'title category level status')
      .sort({ lastAccessedAt: -1, createdAt: -1 })
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
    const moduleProgress = await this.buildModuleProgress(enrollmentId, course?.modules?.length || 0);

    await this.enrollmentModel.findByIdAndUpdate(enrollmentId, {
      progress: progressPercentage,
      completedModules,
      totalScore,
      lastAccessedAt: new Date(),
      isCompleted: completedModules === course?.modules?.length,
      completedAt: completedModules === course?.modules?.length ? new Date() : null,
      moduleProgress,
    });

    return {
      progress: progressPercentage,
      score: totalScore,
      isCompleted: completedModules === course?.modules?.length,
    };
  }

  // Lesson-level tracking: persist last visited lesson and completed lessons
  async updateLessonProgress(
    enrollmentId: string,
    moduleIndex: number,
    lessonIndex: number,
    completed = false,
  ) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) throw new Error('Enrollment not found');

    const course = await this.courseModel.findById(enrollment.courseId).lean();
    if (!course) throw new Error('Course not found');

    const modules = course.modules || [];
    const targetModule = modules[moduleIndex];
    const totalLessons = modules.reduce(
      (sum, m) => sum + (m?.lessons?.length || 0),
      0,
    );

    // Update last accessed pointers
    enrollment.lastAccessedModule = moduleIndex;
    enrollment.lastAccessedLesson = lessonIndex;
    enrollment.lastAccessedAt = new Date();

    // Maintain lesson-level completion list
    const lessonProgress = enrollment.lessonProgress || [];
    const existingIdx = lessonProgress.findIndex(
      (lp) => lp.moduleIndex === moduleIndex && lp.lessonIndex === lessonIndex,
    );

    if (existingIdx >= 0) {
      const wasCompleted = !!lessonProgress[existingIdx].isCompleted;
      lessonProgress[existingIdx].isCompleted = lessonProgress[existingIdx].isCompleted || completed;
      if (!wasCompleted && completed) {
        lessonProgress[existingIdx].completedAt = new Date();
      }
    } else {
      lessonProgress.push({
        moduleIndex,
        lessonIndex,
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
      });
    }

    // Calculate lesson-based progress
    const completedLessons = lessonProgress.filter((lp) => lp.isCompleted).length;
    const progressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    // Derive module completions based on lessons
    const modulesCompleted = modules.reduce((count, m, idx) => {
      const lessons = m?.lessons || [];
      if (lessons.length === 0) return count;
      const done = lessons.every((_, lIdx) =>
        lessonProgress.some(
          (lp) => lp.moduleIndex === idx && lp.lessonIndex === lIdx && lp.isCompleted,
        ),
      );
      return done ? count + 1 : count;
    }, 0);

    enrollment.lessonProgress = lessonProgress;
    enrollment.progress = progressPercent;
    enrollment.completedModules = modulesCompleted;
    enrollment.isCompleted = totalLessons > 0 && completedLessons === totalLessons;
    if (enrollment.isCompleted) {
      enrollment.completedAt = new Date();
    }

    await enrollment.save();
    return enrollment.toObject();
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
      scoreAchieved: enrollment.finalAssessmentScore || 0,
      instructorName: course.instructorId ? 'Instructor' : 'Administrator',
    });

    await certificate.save();

    // Update enrollment with certificate ID
    await this.enrollmentModel.findByIdAndUpdate(enrollmentId, {
      certificateId: certificate._id,
      certificateEarned: true,
      certificateIssuedAt: new Date(),
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

  // Final Assessment Management
  async addFinalAssessment(courseId: string, assessmentData: any) {
    const assessment = {
      title: assessmentData.title || 'Final Assessment',
      description: assessmentData.description || '',
      questions: assessmentData.questions || [],
      passingScore: assessmentData.passingScore || 70,
      order: 999, // Place at the end
    };

    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      { finalAssessment: assessment },
      { new: true },
    );

    if (!updatedCourse) {
      throw new Error('Course not found');
    }

    return updatedCourse;
  }

  async getFinalAssessment(courseId: string) {
    const course = await this.courseModel.findById(courseId).select('finalAssessment');
    return course?.finalAssessment || null;
  }

  async updateFinalAssessment(courseId: string, assessmentData: any) {
    const course = await this.courseModel.findById(courseId);
    if (!course) {
      throw new Error('Course not found');
    }

    if (!course.finalAssessment) {
      return this.addFinalAssessment(courseId, assessmentData);
    }

    const updatedAssessment = {
      ...course.finalAssessment,
      ...assessmentData,
      order: 999, // Always keep at the end
    };

    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      { finalAssessment: updatedAssessment },
      { new: true },
    );

    return updatedCourse;
  }

  async addFinalAssessmentQuestion(courseId: string, question: any) {
    const course = await this.courseModel.findById(courseId);
    if (!course) {
      throw new Error('Course not found');
    }

    if (!course.finalAssessment) {
      course.finalAssessment = {
        title: 'Final Assessment',
        description: '',
        questions: [],
        passingScore: 70,
        order: 999,
      } as any;
    }

    // Use non-null assertion since we just ensured it exists
    course.finalAssessment!.questions!.push(question);
    await course.save();
    return course;
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
    const enrollments = await this.enrollmentModel
      .find({ studentId })
      .populate('courseId', 'title description thumbnailUrl bannerImage modules category level duration')
      .lean();
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
          ...e,
          progressPercentage: e.progress,
        }))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    };
  }

  // Module Assessment Methods
  async submitModuleAssessment(enrollmentId: string, moduleIndex: number, answers: any[]) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    const course = await this.courseModel.findById(enrollment.courseId);
    if (!course || !course.modules || !course.modules[moduleIndex]) {
      throw new Error('Module not found');
    }

    const module = course.modules[moduleIndex];
    if (!module.moduleAssessment || !module.moduleAssessment.questions) {
      throw new Error('Module assessment not found');
    }

    // Find or create module progress
    let moduleProgress = enrollment.moduleProgress.find(mp => mp.moduleIndex === moduleIndex);
    if (!moduleProgress) {
      const newProgress = {
        moduleIndex,
        isCompleted: false,
        assessmentAttempts: 0,
        assessmentPassed: false,
        lastScore: 0,
        completedAt: null,
      } as any;
      enrollment.moduleProgress.push(newProgress);
      moduleProgress = newProgress;
    }

    // Check attempt limit
    if (moduleProgress!.assessmentAttempts >= 3 && !moduleProgress!.assessmentPassed) {
      return {
        success: false,
        error: 'Maximum attempts (3) reached. You must restart the course.',
        attemptsRemaining: 0,
        mustRestartCourse: true,
      };
    }

    // Increment attempts
    moduleProgress!.assessmentAttempts += 1;

    // Grade the assessment (tolerant to index or text answers)
    const questions = module.moduleAssessment.questions;
    let correctCount = 0;
    const normalize = (val: any) =>
      val === undefined || val === null ? '' : String(val).trim().toLowerCase();

    const isCorrectAnswer = (question: any, userAnswer: any) => {
      const normCorrect = normalize(question.correctAnswer);
      const normUser = normalize(userAnswer);

      // Direct match (string/number/case-insensitive)
      if (normCorrect === normUser) return true;

      // Attempt index-based match when options exist
      const hasOptions = Array.isArray(question.options) && question.options.length > 0;
      const parsedIndex = (() => {
        if (typeof userAnswer === 'number' && Number.isInteger(userAnswer)) return userAnswer;
        if (typeof userAnswer === 'string' && userAnswer.trim() !== '' && !isNaN(Number(userAnswer))) {
          return parseInt(userAnswer, 10);
        }
        return null;
      })();

      if (hasOptions && parsedIndex !== null && parsedIndex >= 0 && parsedIndex < question.options.length) {
        const optionValue = normalize(question.options[parsedIndex]);
        if (optionValue === normCorrect) return true; // correctAnswer stores option text
        if (normalize(parsedIndex) === normCorrect) return true; // correctAnswer stores index
      }

      if (hasOptions) {
        const matchedIdx = question.options.findIndex((opt: any) => normalize(opt) === normUser);
        if (matchedIdx >= 0) {
          if (normalize(matchedIdx) === normCorrect) return true; // correctAnswer stores index
          if (normalize(question.options[matchedIdx]) === normCorrect) return true; // correctAnswer stores option text
        }
      }

      return false;
    };

    const results = questions.map((question, idx) => {
      const userAnswer = answers[idx];
      const isCorrect = isCorrectAnswer(question, userAnswer);
      if (isCorrect) correctCount++;
      
      return {
        questionIndex: idx,
        questionText: question.text,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
        explanation: question.explanation,
        points: isCorrect ? question.points : 0,
      };
    });

    const scorePercentage = (correctCount / questions.length) * 100;
    moduleProgress!.lastScore = scorePercentage;

    const passed = scorePercentage >= (module.moduleAssessment.passingScore || 70);
    moduleProgress!.assessmentPassed = passed;

    if (passed) {
      moduleProgress!.isCompleted = true;
      moduleProgress!.completedAt = new Date();
      
      // Update completed modules count
      const completedCount = enrollment.moduleProgress.filter(mp => mp.isCompleted).length;
      enrollment.completedModules = completedCount;
      enrollment.progress = (completedCount / course.modules.length) * 100;
    }

    // Mark array as modified so Mongoose detects the nested changes
    enrollment.markModified('moduleProgress');
    await enrollment.save();

    return {
      success: true,
      passed,
      score: scorePercentage,
      correctCount,
      totalQuestions: questions.length,
      results,
      attemptsUsed: moduleProgress!.assessmentAttempts,
      attemptsRemaining: 3 - moduleProgress!.assessmentAttempts,
      passingScore: module.moduleAssessment.passingScore || 70,
      canRetry: !passed && moduleProgress!.assessmentAttempts < 3,
      mustRestartCourse: !passed && moduleProgress!.assessmentAttempts >= 3,
    };
  }

  // Final Assessment Methods with Retry Logic
  async submitFinalAssessment(enrollmentId: string, answers: any[]) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    const course = await this.courseModel.findById(enrollment.courseId).populate('instructorId', 'firstName lastName email');
    if (!course || !course.finalAssessment) {
      throw new Error('Final assessment not found');
    }

    // Check if all modules are completed
    const allModulesCompleted = course.modules.every((_, idx) => {
      const mp = enrollment.moduleProgress.find(m => m.moduleIndex === idx);
      return mp && mp.isCompleted;
    });

    if (!allModulesCompleted) {
      throw new Error('You must complete all modules before taking the final assessment');
    }

    // Check attempt limit
    if (enrollment.finalAssessmentAttempts >= 3 && !enrollment.finalAssessmentPassed) {
      return {
        success: false,
        error: 'Maximum attempts (3) reached. You must restart the course.',
        attemptsRemaining: 0,
        mustRestartCourse: true,
      };
    }

    // Increment attempts
    enrollment.finalAssessmentAttempts += 1;
    const currentAttemptNumber = enrollment.finalAssessmentAttempts;

    console.log('📝 Submitting final assessment:');
    console.log('   Student:', enrollment.studentId);
    console.log('   Course:', enrollment.courseId);
    console.log('   Attempt #:', currentAttemptNumber);
    console.log('   Answers received:', answers.length);

    // Grade the assessment
    const questions = course.finalAssessment.questions;
    let correctCount = 0;
    let pendingGradingCount = 0;
    let earnedPoints = 0;
    let totalPoints = 0;

    const normalize = (val: any) =>
      val === undefined || val === null ? '' : String(val).trim().toLowerCase();

    const isCorrectAnswer = (question: any, userAnswer: any) => {
      const normCorrect = normalize(question.correctAnswer);
      const normUser = normalize(userAnswer);
      if (normCorrect === normUser) return true;

      const hasOptions = Array.isArray(question.options) && question.options.length > 0;
      const parsedIndex = (() => {
        if (typeof userAnswer === 'number' && Number.isInteger(userAnswer)) return userAnswer;
        if (typeof userAnswer === 'string' && userAnswer.trim() !== '' && !isNaN(Number(userAnswer))) {
          return parseInt(userAnswer, 10);
        }
        return null;
      })();

      if (hasOptions && parsedIndex !== null && parsedIndex >= 0 && parsedIndex < question.options.length) {
        const optionValue = normalize(question.options[parsedIndex]);
        if (optionValue === normCorrect) return true;
        if (normalize(parsedIndex) === normCorrect) return true;
      }

      if (hasOptions) {
        const matchedIdx = question.options.findIndex((opt: any) => normalize(opt) === normUser);
        if (matchedIdx >= 0) {
          if (normalize(matchedIdx) === normCorrect) return true;
          if (normalize(question.options[matchedIdx]) === normCorrect) return true;
        }
      }
      return false;
    };

    const results = questions.map((question, idx) => {
      const userAnswer = answers[idx];
      const questionType = question.type || 'multiple-choice';
      const maxPts = question.points || 1;
      totalPoints += maxPts;

      // For open-ended (essay) questions: store but don't auto-grade
      if (questionType === 'essay') {
        pendingGradingCount++;
        return {
          questionIndex: idx,
          questionText: question.text,
          questionType: 'essay',
          userAnswer: userAnswer || '',
          correctAnswer: undefined, // Not used for essays
          isCorrect: false, // Pending instructor review
          explanation: question.explanation,
          pointsEarned: 0, // Will be set by instructor
          maxPoints: maxPts,
          instructorFeedback: null,
          gradedAt: null,
          requiresManualGrading: true,
        };
      }

      // For closed-ended questions: auto-grade
      const isCorrect = isCorrectAnswer(question, userAnswer);
      if (isCorrect) {
        correctCount++;
        earnedPoints += maxPts;
      }

      return {
        questionIndex: idx,
        questionText: question.text,
        questionType: questionType,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
        explanation: question.explanation,
        pointsEarned: isCorrect ? maxPts : 0,
        maxPoints: maxPts,
        instructorFeedback: null,
        gradedAt: isCorrect ? new Date() : null,
        requiresManualGrading: false,
      };
    });

    // Store detailed results
    if (!enrollment.finalAssessmentResults) {
      enrollment.finalAssessmentResults = [];
    }
    enrollment.finalAssessmentResults = results;
    enrollment.pendingManualGradingCount = pendingGradingCount;

    // Calculate score based on earned vs total points
    const scorePercentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    enrollment.finalAssessmentScore = scorePercentage;

    // Only pass if ALL questions are correctly answered or graded
    // If there are pending essays, mark as not passed until instructor grades
    const passed = pendingGradingCount === 0 && scorePercentage >= (course.finalAssessment.passingScore || 70);
    enrollment.finalAssessmentPassed = passed;

    if (passed) {
      enrollment.isCompleted = true;
      enrollment.completedAt = new Date();
      enrollment.certificateEarned = true;
      
      // Generate certificate
      const student = await this.userModel.findById(enrollment.studentId);
      if (!student) {
        throw new Error('Student not found');
      }
      
      const certificate = await this.certificateModel.create({
        studentId: enrollment.studentId,
        courseId: course._id,
        courseName: course.title,
        studentName: `${student.firstName} ${student.lastName}`,
        instructorName: `${(course.instructorId as any).firstName} ${(course.instructorId as any).lastName}`,
        issuedDate: new Date(),
        completionDate: new Date(),
      });

      enrollment.certificateId = certificate._id as any;
      enrollment.certificateUrl = `/api/certificates/${certificate._id}`;
      enrollment.certificateIssuedAt = new Date();
    }

    await enrollment.save();

    console.log('✅ Final assessment saved:');
    console.log('   Attempt:', enrollment.finalAssessmentAttempts);
    console.log('   Score:', scorePercentage);
    console.log('   Passed:', passed);
    console.log('   Pending grading:', pendingGradingCount);

    return {
      success: true,
      passed,
      score: scorePercentage,
      correctCount,
      totalQuestions: questions.length,
      closedEndedQuestions: questions.length - pendingGradingCount,
      openEndedQuestions: pendingGradingCount,
      results,
      attemptsUsed: enrollment.finalAssessmentAttempts,
      attemptsRemaining: 3 - enrollment.finalAssessmentAttempts,
      passingScore: course.finalAssessment.passingScore || 70,
      canRetry: !passed && enrollment.finalAssessmentAttempts < 3,
      mustRestartCourse: !passed && enrollment.finalAssessmentAttempts >= 3,
      certificateEarned: passed,
      certificateUrl: passed ? enrollment.certificateUrl : null,
      pendingManualGradingCount: pendingGradingCount,
      requiresInstructorGrading: pendingGradingCount > 0,
    };
  }

  // Restart Course (reset all progress and attempts)
  async restartCourse(enrollmentId: string) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    enrollment.moduleProgress = [];
    enrollment.completedModules = 0;
    enrollment.progress = 0;
    enrollment.finalAssessmentAttempts = 0;
    enrollment.finalAssessmentPassed = false;
    enrollment.finalAssessmentScore = 0;
    enrollment.isCompleted = false;
    enrollment.completedAt = undefined;
    enrollment.certificateEarned = false;
    enrollment.certificateId = undefined;
    enrollment.certificateUrl = undefined;
    enrollment.certificateIssuedAt = undefined;

    await enrollment.save();

    return {
      success: true,
      message: 'Course restarted successfully. All progress and attempts have been reset.',
    };
  }

  // Grade open-ended (essay) question responses
  async gradeOpenEndedQuestion(enrollmentId: string, questionIndex: number, isCorrect: boolean, feedback: string, instructorId: string) {
    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    const results = enrollment.finalAssessmentResults;
    if (!results || results[questionIndex] === undefined) {
      throw new Error('Assessment result not found');
    }

    const result = results[questionIndex];
    
    // Update the result with instructor feedback
    result.isCorrect = isCorrect;
    result.instructorFeedback = feedback;
    result.gradedAt = new Date();
    result.gradedBy = instructorId;
    
    // Set points based on instructor decision
    if (isCorrect) {
      result.pointsEarned = result.maxPoints;
    } else {
      result.pointsEarned = 0;
    }

    // Save updated results
    enrollment.finalAssessmentResults = results;

    // Recalculate pending grading count
    let pendingCount = 0;
    let totalPoints = 0;
    let earnedPoints = 0;

    results.forEach((r: any) => {
      totalPoints += r.maxPoints || 0;
      earnedPoints += r.pointsEarned || 0;
      
      if (r.requiresManualGrading && !r.gradedAt) {
        pendingCount++;
      }
    });

    enrollment.pendingManualGradingCount = pendingCount;

    // If all manual grading is done, recalculate final score and check if passed
    if (pendingCount === 0) {
      const newScore = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
      enrollment.finalAssessmentScore = newScore;

      const course = await this.courseModel.findById(enrollment.courseId);
      const passingScore = course?.finalAssessment?.passingScore || 70;

      if (newScore >= passingScore) {
        enrollment.finalAssessmentPassed = true;
        enrollment.isCompleted = true;
        enrollment.completedAt = new Date();
        enrollment.certificateEarned = true;

        // Generate certificate if not already issued
        if (!enrollment.certificateId) {
          const student = await this.userModel.findById(enrollment.studentId);
          const instructor = (course as any)?.instructorId;
          
          const certificate = await this.certificateModel.create({
            studentId: enrollment.studentId,
            courseId: enrollment.courseId,
            courseName: course?.title,
            studentName: `${student?.firstName} ${student?.lastName}`,
            instructorName: `${instructor?.firstName} ${instructor?.lastName}`,
            issuedDate: new Date(),
            completionDate: new Date(),
          });

          enrollment.certificateId = certificate._id as any;
          enrollment.certificateUrl = `/api/certificates/${certificate._id}`;
          enrollment.certificateIssuedAt = new Date();
        }
      }
    }

    await enrollment.save();

    return {
      success: true,
      message: `Question ${questionIndex + 1} graded successfully`,
      updatedEnrollment: {
        finalAssessmentScore: enrollment.finalAssessmentScore,
        finalAssessmentPassed: enrollment.finalAssessmentPassed,
        pendingManualGradingCount: enrollment.pendingManualGradingCount,
        certificateEarned: enrollment.certificateEarned,
        certificateUrl: enrollment.certificateUrl,
      },
    };
  }

  // Get detailed assessment results for a student
  async getAssessmentResults(enrollmentId: string) {
    const enrollment = await this.enrollmentModel
      .findById(enrollmentId)
      .populate('courseId', 'title finalAssessment')
      .populate('studentId', 'firstName lastName email');

    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    const results = enrollment.finalAssessmentResults || [];
    const course = enrollment.courseId as any;

    return {
      enrollmentId: enrollment._id,
      studentName: enrollment.studentId ? `${(enrollment.studentId as any).firstName} ${(enrollment.studentId as any).lastName}` : 'Unknown',
      courseName: course?.title || 'Unknown',
      finalScore: enrollment.finalAssessmentScore,
      passed: enrollment.finalAssessmentPassed,
      attemptNumber: enrollment.finalAssessmentAttempts,
      results: results.map((r: any, idx: number) => ({
        questionIndex: idx,
        questionText: r.questionText,
        questionType: r.questionType,
        studentAnswer: r.studentAnswer,
        correctAnswer: r.correctAnswer,
        isCorrect: r.isCorrect,
        explanation: r.explanation,
        pointsEarned: r.pointsEarned,
        maxPoints: r.maxPoints,
        instructorFeedback: r.instructorFeedback,
        requiresManualGrading: r.requiresManualGrading && !r.gradedAt,
        gradedAt: r.gradedAt,
        gradedBy: r.gradedBy,
      })),
      pendingManualGradingCount: enrollment.pendingManualGradingCount,
      certificateEarned: enrollment.certificateEarned,
      certificateUrl: enrollment.certificateUrl,
    };
  }

  async getCourseSubmissions(courseId: string, instructorId: string) {
    // Verify instructor owns this course
    const course = await this.courseModel.findById(courseId);
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    console.log('📚 Getting submissions for course:', courseId);
    console.log('👨‍🏫 Instructor ID:', instructorId);
    console.log('📖 Course instructor ID:', course.instructorId?.toString());

    const courseInstructorId = course.instructorId?.toString();
    
    // If course has no instructor assigned, assign current instructor
    if (!course.instructorId) {
      console.log('⚠️ Course has no instructor, assigning current instructor');
      course.instructorId = instructorId as any;
      await course.save();
    } else if (courseInstructorId !== instructorId.toString()) {
      console.log('❌ Authorization failed: instructor mismatch');
      throw new UnauthorizedException('You are not authorized to view submissions for this course');
    }

    // Get all enrollments with final assessment submissions
    console.log('🔍 Querying enrollments where finalAssessmentAttempts > 0...');
    console.log('   courseId input:', courseId, typeof courseId);
    console.log('   courseId as ObjectId:', new Types.ObjectId(courseId).toString());
    
    // Build query that works with both ObjectId and string references
    const courseIdObj = new Types.ObjectId(courseId);
    
    let enrollments = await this.enrollmentModel
      .find({
        $or: [
          { courseId: courseIdObj },
          { courseId: courseId as any }, // Also try string match
        ],
        finalAssessmentAttempts: { $gt: 0 }, // Only get students who have submitted
      })
      .populate('studentId', 'firstName lastName email')
      .populate('courseId', 'title finalAssessment')
      .lean();

    console.log('📝 Found enrollments with submissions:', enrollments.length);
    
    if (enrollments.length === 0) {
      console.log('⚠️ No submissions found. Checking all enrollments for this course...');
      const allEnrollments = await this.enrollmentModel
        .find({
          $or: [
            { courseId: courseIdObj },
            { courseId: courseId as any },
          ],
        })
        .select('_id studentId finalAssessmentAttempts finalAssessmentScore courseId');
      
      console.log('   Total enrollments for this course:', allEnrollments.length);
      allEnrollments.forEach((e: any) => {
        console.log(`   Enrollment ${e._id}:`);
        console.log(`     - finalAssessmentAttempts: ${e.finalAssessmentAttempts}`);
        console.log(`     - courseId: ${e.courseId} (type: ${typeof e.courseId}, constructor: ${e.courseId?.constructor?.name})`);
        console.log(`     - courseId.toString(): ${e.courseId?.toString()}`);
      });
      
      // If still no enrollments, try without any filtering by course
      console.log('⚠️ Trying broader search - all enrollments with attempts > 0:');
      const anyAttempts = await this.enrollmentModel
        .find({ finalAssessmentAttempts: { $gt: 0 } })
        .select('_id studentId courseId finalAssessmentAttempts finalAssessmentScore');
      
      console.log('   Found ', anyAttempts.length, 'total enrollments with attempts across ALL courses');
      anyAttempts.slice(0, 5).forEach((e: any) => {
        console.log(`     Enrollment courseId: ${e.courseId}, attempts: ${e.finalAssessmentAttempts}`);
      });
    }

    return enrollments.map(enrollment => {
      const student = enrollment.studentId as any;
      const courseData = enrollment.courseId as any;
      const results = enrollment.finalAssessmentResults || [];
      
      // Determine status: reviewed if no pending grading, else pending
      const status = (enrollment.pendingManualGradingCount || 0) > 0 ? 'pending' : 'reviewed';
      
      return {
        _id: enrollment._id,
        enrollmentId: enrollment._id,
        studentId: student?._id,
        studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown Student',
        studentEmail: student?.email,
        submittedAt: enrollment.updatedAt || enrollment.createdAt,
        autoGradedScore: enrollment.finalAssessmentScore || 0,
        finalScore: enrollment.finalAssessmentScore,
        passed: enrollment.finalAssessmentPassed,
        status,
        passingScore: courseData?.finalAssessment?.passingScore || 70,
        questions: courseData?.finalAssessment?.questions || [],
        answers: results.map((r: any, idx: number) => ({
          questionIndex: idx,
          questionText: r.questionText,
          questionType: r.questionType || courseData?.finalAssessment?.questions[idx]?.type || 'multiple-choice',
          studentAnswer: r.studentAnswer || r.userAnswer,
          value: r.studentAnswer || r.userAnswer,
          correctAnswer: r.correctAnswer,
          isCorrect: r.isCorrect,
          instructorFeedback: r.instructorFeedback,
          requiresManualGrading: r.requiresManualGrading && !r.gradedAt,
          gradedAt: r.gradedAt,
        })),
        pendingManualGradingCount: enrollment.pendingManualGradingCount || 0,
      };
    });
  }

  async submitAssessmentReview(reviewData: any, instructorId: string) {
    const { enrollmentId, essayFeedback, finalScore, passed } = reviewData;

    const enrollment = await this.enrollmentModel.findById(enrollmentId);
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const course = await this.courseModel.findById(enrollment.courseId);
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Verify instructor owns this course
    if (course.instructorId?.toString() !== instructorId.toString()) {
      throw new UnauthorizedException('You are not authorized to review this submission');
    }

    const results = enrollment.finalAssessmentResults || [];
    let pendingCount = 0;

    // Update essay question results with instructor feedback
    Object.keys(essayFeedback).forEach((questionIdx) => {
      const idx = parseInt(questionIdx);
      const feedback = essayFeedback[questionIdx];
      
      if (results[idx] && results[idx].questionType === 'essay') {
        results[idx].isCorrect = feedback.isCorrect === true;
        results[idx].instructorFeedback = feedback.feedback || '';
        results[idx].gradedAt = new Date();
        results[idx].gradedBy = new Types.ObjectId(instructorId);
        
        // Update points earned
        if (feedback.isCorrect) {
          results[idx].pointsEarned = results[idx].maxPoints || 0;
        } else {
          results[idx].pointsEarned = 0;
        }
      }
    });

    // Count remaining pending essays
    results.forEach((r: any) => {
      if (r.questionType === 'essay' && !r.gradedAt) {
        pendingCount++;
      }
    });

    // Update enrollment with reviewed results
    enrollment.finalAssessmentResults = results;
    enrollment.pendingManualGradingCount = pendingCount;
    enrollment.finalAssessmentScore = finalScore;
    enrollment.finalAssessmentPassed = passed;

    if (passed) {
      enrollment.isCompleted = true;
      enrollment.completedAt = new Date();
      enrollment.certificateEarned = true;
      
      // Generate certificate if not already created
      if (!enrollment.certificateId) {
        console.log('🎓 Generating certificate for student...');
        const certificate = await this.generateCertificate(enrollment._id.toString(), enrollment.studentId.toString(), enrollment.courseId.toString());
        enrollment.certificateId = certificate._id;
        enrollment.certificateUrl = `${process.env.APP_URL || 'http://localhost:3000'}/certificates/${certificate._id}`;
        enrollment.certificateIssuedAt = new Date();
        console.log('✅ Certificate generated:', certificate._id);
      }
    }

    await enrollment.save();

    return {
      message: 'Assessment review submitted successfully',
      finalScore,
      passed,
      certificateEarned: enrollment.certificateEarned,
      certificateId: enrollment.certificateId,
      certificateUrl: enrollment.certificateUrl,
    };
  }
}

