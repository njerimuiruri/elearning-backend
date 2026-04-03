import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdmissionLettersController } from './admission-letters.controller';
import { AdmissionLettersService } from './admission-letters.service';
import {
  AdmissionLetterTemplate,
  AdmissionLetterTemplateSchema,
} from '../schemas/admission-letter-template.schema';
import {
  AdmissionLetterSend,
  AdmissionLetterSendSchema,
} from '../schemas/admission-letter-send.schema';
import {
  AdminFromEmail,
  AdminFromEmailSchema,
} from '../schemas/admin-from-email.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: AdmissionLetterTemplate.name,
        schema: AdmissionLetterTemplateSchema,
      },
      { name: AdmissionLetterSend.name, schema: AdmissionLetterSendSchema },
      { name: AdminFromEmail.name, schema: AdminFromEmailSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CommonModule,
  ],
  controllers: [AdmissionLettersController],
  providers: [AdmissionLettersService],
})
export class AdmissionLettersModule {}
