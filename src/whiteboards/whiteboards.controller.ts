import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { WhiteboardsService } from './whiteboards.service';

@Controller('api/whiteboards')
@UseGuards(JwtAuthGuard)
export class WhiteboardsController {
  constructor(private readonly service: WhiteboardsService) {}

  /** POST /whiteboards  create a new whiteboard */
  @Post()
  async create(@Request() req, @Body() body: any) {
    const data = await this.service.create(req.user.id, body.title, body.pages, body.textLayers);
    return { success: true, data };
  }

  /** GET /whiteboards/my  instructor's own whiteboards (no page data) */
  @Get('my')
  async getMyWhiteboards(@Request() req) {
    const data = await this.service.getMyWhiteboards(req.user.id);
    return { success: true, data };
  }

  /** GET /whiteboards/admin/all  all whiteboards (admin only) */
  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllWhiteboards() {
    const data = await this.service.getAllWhiteboards();
    return { success: true, data };
  }

  /** DELETE /whiteboards/admin/:id  admin can delete any whiteboard */
  @Delete('admin/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminDelete(@Param('id') id: string) {
    return this.service.adminDelete(id);
  }

  /**
   * GET /whiteboards/shared/category/:categoryId
   * Returns whiteboards shared with the given category (student-facing)
   * Must be defined BEFORE :id to avoid route conflict
   */
  @Get('shared/category/:categoryId')
  async getSharedForCategory(@Param('categoryId') categoryId: string) {
    const data = await this.service.getSharedForCategory(categoryId);
    return { success: true, data };
  }

  /** GET /whiteboards/:id  full whiteboard including pages */
  @Get(':id')
  async getById(@Param('id') id: string) {
    const data = await this.service.getById(id);
    return { success: true, data };
  }

  /** PUT /whiteboards/:id  save title + pages + text layers */
  @Put(':id')
  async update(@Request() req, @Param('id') id: string, @Body() body: any) {
    const data = await this.service.update(id, req.user.id, body.title, body.pages, body.textLayers);
    return { success: true, data };
  }

  /** POST /whiteboards/:id/share  set which categories can see this */
  @Post(':id/share')
  async share(@Request() req, @Param('id') id: string, @Body() body: any) {
    const data = await this.service.share(id, req.user.id, body.categoryIds || []);
    return { success: true, data };
  }

  /** DELETE /whiteboards/:id */
  @Delete(':id')
  async delete(@Request() req, @Param('id') id: string) {
    return this.service.delete(id, req.user.id);
  }
}
