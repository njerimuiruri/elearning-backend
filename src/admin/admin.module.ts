import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from '../schemas/user.schema';
import { PasswordReset, PasswordResetSchema } from '../schemas/password-reset.schema';
import { Course, CourseSchema } from '../schemas/course.schema';
import { EmailService } from '../common/services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
      { name: Course.name, schema: CourseSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, EmailService],
  exports: [AdminService],
})
export class AdminModule {}