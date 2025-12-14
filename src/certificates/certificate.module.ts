import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';
import { Certificate, CertificateSchema } from '../schemas/certificate.schema';
import { Enrollment, EnrollmentSchema } from '../schemas/enrollment.schema';
import { Course, CourseSchema } from '../schemas/course.schema';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Course.name, schema: CourseSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CertificateController],
  providers: [CertificateService],
  exports: [CertificateService],
})
export class CertificateModule {}
