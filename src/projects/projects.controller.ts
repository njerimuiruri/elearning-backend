import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, Request,
  UseGuards, UseInterceptors, UploadedFile,
  ParseFilePipe, MaxFileSizeValidator, FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../schemas/user.schema';
import { ProjectsService } from './projects.service';

const TEN_MB = 10 * 1024 * 1024;

const ALLOWED_MIME =
  /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;

const fileUploadPipe = new ParseFilePipe({
  validators: [
    new MaxFileSizeValidator({ maxSize: TEN_MB }),
    new FileTypeValidator({ fileType: ALLOWED_MIME }),
  ],
  fileIsRequired: true,
});

// ── Student routes (/api/projects) ────────────────────────────────────────────

@Controller('api/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** POST /api/projects — submit a new document */
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async submit(
    @Request() req: any,
    @UploadedFile(fileUploadPipe) file: Express.Multer.File,
    @Body() body: any,
  ) {
    const user = req.user;
    const studentName =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.fullName || user.email || 'Student';
    const tags = parseTags(body);

    const project = await this.projectsService.submitProject(
      user.id || user._id,
      studentName,
      body.title,
      body.description,
      tags,
      file,
    );
    return { success: true, message: 'Document submitted for review', data: project };
  }

  /** GET /api/projects/my — student's own submissions */
  @Get('my')
  async mySubmissions(@Request() req: any) {
    const projects = await this.projectsService.getMySubmissions(
      req.user.id || req.user._id,
    );
    return { success: true, data: projects };
  }

  /** GET /api/projects/admin-resources — admin-uploaded docs for this fellow */
  @Get('admin-resources')
  async adminResources(@Request() req: any) {
    const projects = await this.projectsService.getAdminResourcesForFellow(
      req.user.email,
    );
    return { success: true, data: projects };
  }

  /** GET /api/projects — approved community documents (student-submitted) */
  @Get()
  async community(
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const projects = await this.projectsService.getCommunityProjects({
      search, tag,
      limit: limit ? parseInt(limit) : 100,
      skip: skip ? parseInt(skip) : 0,
    });
    return { success: true, data: projects };
  }

  /** PUT /api/projects/:id — student updates own pending submission */
  @Put(':id')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    const tags = Array.isArray(body['tags[]'])
      ? body['tags[]']
      : body['tags[]'] ? [body['tags[]']]
      : Array.isArray(body.tags) ? body.tags
      : body.tags ? [body.tags] : [];

    const project = await this.projectsService.updateSubmission(
      id,
      req.user.id || req.user._id,
      { title: body.title, description: body.description, tags },
    );
    return { success: true, message: 'Document updated', data: project };
  }

  /** POST /api/projects/:id/rate — rate a community project */
  @Post(':id/rate')
  async rate(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { rating: number },
  ) {
    const project = await this.projectsService.rateProject(
      id,
      req.user.id || req.user._id,
      Number(body.rating),
    );
    return { success: true, data: project };
  }

  /** DELETE /api/projects/:id — delete own pending submission */
  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    await this.projectsService.deleteSubmission(id, req.user.id || req.user._id);
    return { success: true, message: 'Submission deleted' };
  }
}

// ── Admin routes (/api/admin/projects) ────────────────────────────────────────

@Controller('api/admin/projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** POST /api/admin/projects/upload — admin uploads a resource for fellows */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadResource(
    @Request() req: any,
    @UploadedFile(fileUploadPipe) file: Express.Multer.File,
    @Body() body: any,
  ) {
    const admin = req.user;
    const adminName =
      `${admin.firstName || ''} ${admin.lastName || ''}`.trim() ||
      admin.email || 'Admin';

    const project = await this.projectsService.adminUploadResource(
      admin.id || admin._id,
      adminName,
      {
        title: body.title,
        description: body.description,
        tags: parseTags(body),
        authorName: body.authorName || adminName,
        authorEmail: body.authorEmail || admin.email || '',
        targetEmail: body.targetEmail || undefined,
      },
      file,
    );
    return { success: true, message: 'Resource uploaded and published', data: project };
  }

  /** GET /api/admin/projects */
  @Get()
  async getAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const result = await this.projectsService.adminGetAll({
      status, search, type,
      limit: limit ? parseInt(limit) : 50,
      skip: skip ? parseInt(skip) : 0,
    });
    return { success: true, ...result };
  }

  /** PUT /api/admin/projects/:id/approve */
  @Put(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { feedback?: string }) {
    const project = await this.projectsService.adminApprove(id, body.feedback);
    return { success: true, message: 'Project approved', data: project };
  }

  /** PUT /api/admin/projects/:id/reject */
  @Put(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { feedback?: string }) {
    const project = await this.projectsService.adminReject(id, body.feedback);
    return { success: true, message: 'Project rejected', data: project };
  }

  /** POST /api/admin/projects/:id/feedback */
  @Post(':id/feedback')
  async feedback(@Param('id') id: string, @Body() body: { comment: string }) {
    const project = await this.projectsService.adminAddFeedback(id, body.comment);
    return { success: true, data: project };
  }

  /** DELETE /api/admin/projects/:id — admin deletes a resource */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.projectsService.adminDeleteResource(id);
    return { success: true, message: 'Resource deleted' };
  }
}

// ── helpers ────────────────────────────────────────────────────────────────────

function parseTags(body: any): string[] {
  if (Array.isArray(body['tags[]'])) return body['tags[]'];
  if (body['tags[]']) return [body['tags[]']];
  if (Array.isArray(body.tags)) return body.tags;
  if (body.tags) return [body.tags];
  return [];
}
