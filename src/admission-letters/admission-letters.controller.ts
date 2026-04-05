import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdmissionLettersService } from './admission-letters.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';
import {
  SavePdfTemplateDto,
  CreateFromEmailDto,
  SendAdmissionLettersDto,
} from './dto/admission-letter.dto';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Controller('api/admission-letters')
export class AdmissionLettersController {
  constructor(private readonly service: AdmissionLettersService) {}

  // ─── PDF Templates (Admin only) ──────────────────────────────────────────

  @Post('pdfs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  savePdf(@Body() dto: SavePdfTemplateDto, @CurrentUser() user: any) {
    return this.service.saveTemplate(dto, user._id || user.userId);
  }

  @Get('pdfs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  listPdfs() {
    return this.service.listTemplates();
  }

  @Delete('pdfs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  deletePdf(@Param('id') id: string) {
    return this.service.deleteTemplate(id);
  }

  // ─── Sender Email Addresses (Admin only) ─────────────────────────────────

  @Get('from-emails')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  listFromEmails() {
    return this.service.listFromEmails();
  }

  @Post('from-emails')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  addFromEmail(
    @Body() dto: CreateFromEmailDto,
    @CurrentUser() user: any,
  ) {
    return this.service.addFromEmail(dto, user._id || user.userId);
  }

  @Delete('from-emails/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  removeFromEmail(@Param('id') id: string) {
    return this.service.removeFromEmail(id);
  }

  // ─── Fellows for recipient selection (Admin only) ─────────────────────────

  @Get('fellows')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getFellows(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getFellows({
      search,
      categoryId,
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  // ─── Bulk Send (Admin only) ───────────────────────────────────────────────

  @Post('send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  sendLetters(
    @Body() dto: SendAdmissionLettersDto,
    @CurrentUser() user: any,
  ) {
    return this.service.sendBulk(dto, user._id || user.userId);
  }

  // ─── Logs (Admin only) ───────────────────────────────────────────────────

  @Get('logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getLogs(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getLogs({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get('logs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getLogDetail(@Param('id') id: string) {
    return this.service.getLogDetail(id);
  }

  @Delete('logs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  deleteLog(@Param('id') id: string) {
    return this.service.deleteLog(id);
  }

  // ─── Public: Inline file viewer (no auth — linked from email) ───────────────

  @Get('view/:templateId')
  @Public()
  async viewTemplate(
    @Param('templateId') templateId: string,
    @Res() res: Response,
  ) {
    return this.service.streamTemplate(templateId, res);
  }

  // ─── Public Tracking Endpoints (no auth — email client requests) ──────────

  @Get('track/:token/pixel.png')
  async trackOpen(@Param('token') token: string, @Res() res: Response) {
    // Fire and forget — never block the image response
    this.service.recordOpen(token);

    // 1×1 transparent PNG
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Content-Length': pixel.length.toString(),
    });
    res.send(pixel);
  }

  @Get('acknowledge/:token')
  acknowledgeReceipt(@Param('token') token: string) {
    return this.service.recordAcknowledgement(token);
  }
}
