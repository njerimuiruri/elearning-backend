import {
  Controller,
  Get,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProgressionService } from './progression.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { ModuleLevel } from '../schemas/module.schema';

@Controller('progression')
export class ProgressionController {
  constructor(private readonly progressionService: ProgressionService) {}

  // Get progression for category
  @Get('category/:categoryId')
  @UseGuards(JwtAuthGuard)
  async getProgressionForCategory(
    @Param('categoryId') categoryId: string,
    @Request() req,
  ) {
    return await this.progressionService.getProgressionStatus(
      req.user.id,
      categoryId,
    );
  }

  // Check level access
  @Get('category/:categoryId/level/:level/access')
  @UseGuards(JwtAuthGuard)
  async checkLevelAccess(
    @Param('categoryId') categoryId: string,
    @Param('level') level: ModuleLevel,
    @Request() req,
  ) {
    const canAccess = await this.progressionService.canAccessLevel(
      req.user.id,
      categoryId,
      level,
    );
    return { canAccess };
  }

  // Get all student progressions
  @Get('my-progressions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  async getMyProgressions(@Request() req) {
    return await this.progressionService.getAllProgressions(req.user.id);
  }

  /**
   * GET /progression/category/:categoryId/level-status
   * Returns unlocked/completed/locked status for all three levels.
   * Used by the frontend to render the level progress UI.
   */
  @Get('category/:categoryId/level-status')
  @UseGuards(JwtAuthGuard)
  async getLevelAccessStatus(
    @Param('categoryId') categoryId: string,
    @Request() req,
  ) {
    const status = await this.progressionService.getLevelAccessStatus(
      req.user.id,
      categoryId,
    );
    return { success: true, data: status };
  }
}
