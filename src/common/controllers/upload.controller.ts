import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../services/cloudinary.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('api/upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate image file
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid image format. Allowed: JPEG, PNG, GIF, WebP');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be less than 5MB');
    }

    try {
      const imageUrl = await this.cloudinaryService.uploadImage(
        file.buffer,
        file.originalname,
      );
      return { success: true, url: imageUrl };
    } catch (error) {
      throw new BadRequestException(`Upload failed: ${error.message}`);
    }
  }

  @Post('video')
  @UseInterceptors(FileInterceptor('file'))
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate video file
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid video format. Allowed: MP4, MOV, AVI');
    }

    if (file.size > 100 * 1024 * 1024) {
      throw new BadRequestException('Video size must be less than 100MB');
    }

    try {
      const videoUrl = await this.cloudinaryService.uploadVideo(
        file.buffer,
        file.originalname,
      );
      return { success: true, url: videoUrl };
    } catch (error) {
      throw new BadRequestException(`Upload failed: ${error.message}`);
    }
  }
}
