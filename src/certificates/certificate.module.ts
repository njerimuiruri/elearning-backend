import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';
import { ModuleCertificateService } from './module-certificate.service';
import { Certificate, CertificateSchema } from '../schemas/certificate.schema';
import { Enrollment, EnrollmentSchema } from '../schemas/enrollment.schema';
import { Course, CourseSchema } from '../schemas/course.schema';
import { User, UserSchema } from '../schemas/user.schema';
import {
  ModuleCertificate,
  ModuleCertificateSchema,
} from '../schemas/module-certificate.schema';
import {
  ModuleEnrollment,
  ModuleEnrollmentSchema,
} from '../schemas/module-enrollment.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Course.name, schema: CourseSchema },
      { name: User.name, schema: UserSchema },
      { name: ModuleCertificate.name, schema: ModuleCertificateSchema },
      { name: ModuleEnrollment.name, schema: ModuleEnrollmentSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
    ]),
  ],
  controllers: [CertificateController],
  providers: [CertificateService, ModuleCertificateService],
  exports: [CertificateService, ModuleCertificateService],
})
export class CertificateModule {}
