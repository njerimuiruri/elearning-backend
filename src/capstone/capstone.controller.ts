import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { CapstoneService } from './capstone.service';

const FIFTY_MB = 50 * 1024 * 1024;

const multerOpts = {
  storage: memoryStorage(),
  limits: { fileSize: FIFTY_MB },
};

@ApiTags('Capstone')
@Controller('api/capstone')
@UseGuards(JwtAuthGuard)
export class CapstoneController {
  constructor(private readonly capstoneService: CapstoneService) {}

  // ── Student endpoints ──────────────────────────────────────────────────────

  /** GET /api/capstone/my — student's own capstone record */
  @Get('my')
  @ApiOperation({ summary: "Get the authenticated student's capstone" })
  async getMyCapstone(@Request() req: any) {
    return this.capstoneService.getMyCapstone(req.user.id || req.user._id);
  }

  /** POST /api/capstone — submit initial proposal (multipart) */
  @Post()
  @UseInterceptors(FilesInterceptor('files', 3, multerOpts))
  @ApiOperation({ summary: 'Submit capstone proposal' })
  async submitProposal(
    @Request() req: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any,
  ) {
    const user = req.user;
    const studentName =
      user.fullName ||
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.email;
    return this.capstoneService.submitProposal(
      user.id || user._id,
      studentName,
      user.email,
      body.title,
      body.description,
      files || [],
    );
  }

  /** PUT /api/capstone/:id/resubmit — resubmit after revision request (multipart) */
  @Put(':id/resubmit')
  @UseInterceptors(FilesInterceptor('files', 3, multerOpts))
  @ApiOperation({ summary: 'Resubmit capstone proposal after revision' })
  async resubmitRevision(
    @Param('id') id: string,
    @Request() req: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any,
  ) {
    return this.capstoneService.resubmitRevision(
      id,
      req.user.id || req.user._id,
      body.title,
      body.description,
      files || [],
    );
  }

  /** PUT /api/capstone/:id/implementation — upload final implementation files (multipart) */
  @Put(':id/implementation')
  @UseInterceptors(FilesInterceptor('files', 3, multerOpts))
  @ApiOperation({ summary: 'Submit final project implementation' })
  async submitImplementation(
    @Param('id') id: string,
    @Request() req: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any,
  ) {
    return this.capstoneService.submitImplementation(
      id,
      req.user.id || req.user._id,
      files || [],
      body.notes || '',
    );
  }

  /** DELETE /api/capstone/:id — student withdraws their own submission */
  @Delete(':id')
  @ApiOperation({ summary: 'Student withdraws their own capstone submission' })
  async withdrawCapstone(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.capstoneService.withdrawCapstone(id, req.user.id || req.user._id);
  }

  // ── Instructor / Admin endpoints ───────────────────────────────────────────
  // NOTE: These static routes (/admin) are declared before the dynamic (:id)
  // routes so NestJS/Express matches them correctly.

  /** GET /api/capstone/admin — list all submissions with optional filters */
  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'List all capstone submissions (instructor/admin)' })
  async getAllCapstones(@Query() query: any) {
    return this.capstoneService.getAllCapstones({
      status: query.status,
      search: query.search,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
    });
  }

  /** PUT /api/capstone/:id/approve — approve the proposal */
  @Put(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Approve capstone proposal' })
  async approveProposal(
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return this.capstoneService.approveProposal(id, body.comment || '');
  }

  /** PUT /api/capstone/:id/revision — request revision from student */
  @Put(':id/revision')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Request revision on capstone proposal' })
  async requestRevision(
    @Param('id') id: string,
    @Body() body: { comment: string },
  ) {
    return this.capstoneService.requestRevision(id, body.comment);
  }

  /** PUT /api/capstone/:id/reject — reject the capstone outright */
  @Put(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Reject capstone submission' })
  async rejectCapstone(
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return this.capstoneService.rejectCapstone(id, body.comment || '');
  }

  /** POST /api/capstone/:id/comment — add inline feedback without changing status */
  @Post(':id/comment')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Add a comment to a capstone submission' })
  async addComment(
    @Param('id') id: string,
    @Body() body: { comment: string },
  ) {
    return this.capstoneService.addComment(id, body.comment);
  }

  /** PUT /api/capstone/:id/grade — grade the final implementation */
  @Put(':id/grade')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Grade the capstone final implementation' })
  async gradeCapstone(
    @Param('id') id: string,
    @Body() body: { grade: number; feedback: string; passed: boolean },
  ) {
    return this.capstoneService.gradeCapstone(id, body);
  }

  /** GET /api/capstone/:id — get a single capstone by ID (instructor/admin) */
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Get capstone by ID (instructor/admin)' })
  async getCapstoneById(@Param('id') id: string) {
    return this.capstoneService.getCapstoneById(id);
  }

  /** DELETE /api/capstone/:id/force — instructor/admin force-deletes any submission */
  @Delete(':id/force')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @ApiOperation({ summary: 'Instructor/admin force-deletes a capstone submission' })
  async forceDeleteCapstone(@Param('id') id: string) {
    return this.capstoneService.forceDeleteCapstone(id);
  }
}
