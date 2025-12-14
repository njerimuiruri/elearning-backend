import { Module } from '@nestjs/common';
import { CloudinaryService } from './services/cloudinary.service';
import { EmailService } from './services/email.service';
import { UploadController } from './controllers/upload.controller';

@Module({
  providers: [CloudinaryService, EmailService],
  exports: [CloudinaryService, EmailService],
  controllers: [UploadController],
})
export class CommonModule {}
