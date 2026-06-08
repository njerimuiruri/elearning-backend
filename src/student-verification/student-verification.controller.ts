import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudentVerificationService } from './student-verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { CurrentUser } from '../decorators/current-user.decorator';

@Controller('api/student-verification')
export class StudentVerificationController {
  constructor(private readonly service: StudentVerificationService) {}

  /**
   * POST /api/student-verification/upload
   * Student uploads their student ID after paying student price
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadStudentId(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, or PDF files are accepted');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size must be under 5MB');
    }

    return this.service.uploadStudentId(user._id, file.buffer, file.originalname);
  }

  /**
   * GET /api/student-verification/status
   * Get current user's verification status
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getMyStatus(@CurrentUser() user: any) {
    return this.service.getVerificationStatus(user._id);
  }

  /**
   * GET /api/student-verification/admin/pending
   * Admin: get all pending verifications
   */
  @Get('admin/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getPending(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.service.getPendingVerifications(Number(page), Number(limit));
  }

  /**
   * GET /api/student-verification/admin/all
   * Admin: get all verifications with optional status filter
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAll(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    return this.service.getAllVerifications(Number(page), Number(limit), status);
  }

  /**
   * POST /api/student-verification/admin/:userId/approve
   * Admin: approve a student verification
   */
  @Post('admin/:userId/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async approve(@Param('userId') userId: string) {
    return this.service.approveVerification(userId);
  }

  /**
   * POST /api/student-verification/admin/:userId/reject
   * Admin: reject a student verification
   */
  @Post('admin/:userId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reject(
    @Param('userId') userId: string,
    @Body('reason') reason: string,
  ) {
    if (!reason?.trim()) throw new BadRequestException('Rejection reason is required');
    return this.service.rejectVerification(userId, reason);
  }
}
