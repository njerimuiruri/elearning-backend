import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CourseService } from './courses.service';
import { CourseController } from './courses.controller';
import { Course, CourseSchema } from '../schemas/course.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Enrollment, EnrollmentSchema } from '../schemas/enrollment.schema';
import { Progress, ProgressSchema } from '../schemas/progress.schema';
import { Certificate, CertificateSchema } from '../schemas/certificate.schema';
import { Discussion, DiscussionSchema } from '../schemas/discussion.schema';
import { EmailReminder, EmailReminderSchema } from '../schemas/email-reminder.schema';
import { InstructorReview, InstructorReviewSchema } from '../schemas/instructor-review.schema';
import { EmailService } from '../common/services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Course.name, schema: CourseSchema },
      { name: User.name, schema: UserSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Progress.name, schema: ProgressSchema },
      { name: Certificate.name, schema: CertificateSchema },
      { name: Discussion.name, schema: DiscussionSchema },
      { name: EmailReminder.name, schema: EmailReminderSchema },
      { name: InstructorReview.name, schema: InstructorReviewSchema },
    ]),
  ],
  providers: [CourseService, EmailService],
  controllers: [CourseController],
  exports: [CourseService],
})
export class CoursesModule {}
