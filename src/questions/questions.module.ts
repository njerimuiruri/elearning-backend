import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuestionAnswerController } from './questions.controller';
import { QuestionAnswerService } from './question-answer.service';
import { QuestionAnswer, QuestionAnswerSchema } from './schemas/question-answer.schema';
import { Enrollment, EnrollmentSchema } from '../schemas/enrollment.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Course, CourseSchema } from '../schemas/course.schema';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QuestionAnswer.name, schema: QuestionAnswerSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: User.name, schema: UserSchema },
      { name: Course.name, schema: CourseSchema },
    ]),
    CommonModule,
  ],
  controllers: [QuestionAnswerController],
  providers: [QuestionAnswerService],
  exports: [QuestionAnswerService],
})
export class QuestionsModule {}
