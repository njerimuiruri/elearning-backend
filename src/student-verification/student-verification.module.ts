import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudentVerificationController } from './student-verification.controller';
import { StudentVerificationService } from './student-verification.service';
import { User, UserSchema } from '../schemas/user.schema';
import { CommonModule } from '../common/common.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    CommonModule,
    CategoriesModule,
  ],
  controllers: [StudentVerificationController],
  providers: [StudentVerificationService],
  exports: [StudentVerificationService],
})
export class StudentVerificationModule {}
