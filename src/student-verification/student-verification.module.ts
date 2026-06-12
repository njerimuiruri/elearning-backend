import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { StudentVerificationController } from './student-verification.controller';
import { StudentVerificationService } from './student-verification.service';
import { User, UserSchema } from '../schemas/user.schema';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    CommonModule,
  ],
  controllers: [StudentVerificationController],
  providers: [StudentVerificationService],
  exports: [StudentVerificationService],
})
export class StudentVerificationModule {}
