import {
  Controller,
  Post,
  Get,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { CloudinaryService } from '../services/cloudinary.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

// Ensure upload subdirectories exist at startup
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');
for (const sub of ['images', 'documents']) {
  const dir = path.join(UPLOADS_ROOT, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Sanitise the original filename: keep letters, digits, dots, hyphens only
function safeFilename(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const base = path
    .basename(original, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 60);
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`;
}

// Convert Multer LIMIT_FILE_SIZE into a clean 413 response
function handleUploadError(error: any): never {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    throw new HttpException('File too large', HttpStatus.PAYLOAD_TOO_LARGE);
  }
  throw new BadRequestException(error?.message ?? 'Upload failed');
}

@Controller('api/upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  // ── Images → local disk ───────────────────────────────────────────────────
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: path.join(UPLOADS_ROOT, 'images'),
        filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      fs.unlinkSync(file.path); // clean up rejected file
      throw new BadRequestException(
        'Invalid image format. Allowed: JPEG, PNG, GIF, WebP',
      );
    }

    // Return a URL the frontend can use directly
    return { success: true, url: `/uploads/images/${file.filename}` };
  }

  // ── Documents → local disk ────────────────────────────────────────────────
  @Post('document')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: path.join(UPLOADS_ROOT, 'documents'),
        filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'application/zip',
      'application/octet-stream',
    ];
    if (!allowed.includes(file.mimetype)) {
      fs.unlinkSync(file.path);
      throw new BadRequestException(
        'Invalid document format. Allowed: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, CSV, TXT, ZIP',
      );
    }

    return {
      success: true,
      url: `/uploads/documents/${file.filename}`,
      originalName: file.originalname,
    };
  }

  // ── Videos → Cloudinary (large files, CDN delivery) ──────────────────────
  @Post('video')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
    }),
  )
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const allowed = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-msvideo',
    ];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid video format. Allowed: MP4, WebM, OGG, MOV, AVI',
      );
    }

    try {
      const videoUrl = await this.cloudinaryService.uploadVideo(
        file.buffer,
        file.originalname,
      );
      return { success: true, url: videoUrl };
    } catch (error) {
      handleUploadError(error);
    }
  }

  // ── Document download → streams local file with correct Content-Type ────────
  @Get('resource')
  async downloadResource(
    @Query('file') fileName: string,
    @Query('name') displayName: string,
    @Res() res: Response,
  ) {
    if (!fileName) throw new BadRequestException('file is required');

    // Prevent path traversal
    const safe = path.basename(fileName);
    const filePath = path.join(UPLOADS_ROOT, 'documents', safe);

    if (!fs.existsSync(filePath)) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }

    const ext = path.extname(safe).slice(1).toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      csv: 'text/csv',
      txt: 'text/plain',
      zip: 'application/zip',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const download = displayName ? decodeURIComponent(displayName) : safe;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${download}"`);
    fs.createReadStream(filePath).pipe(res);
  }
}
