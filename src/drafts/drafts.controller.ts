import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { DraftsService } from './drafts.service';
import { UpsertDraftDto } from './dto/upsert-draft.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';

@Controller('api/drafts')
@UseGuards(JwtAuthGuard)
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @Put(':draftKey')
  async upsert(
    @CurrentUser() user: any,
    @Param('draftKey') draftKey: string,
    @Body() dto: UpsertDraftDto,
  ) {
    const userId = user._id?.toString() ?? user.id?.toString();
    const draft = await this.draftsService.upsert(userId, draftKey, dto);
    return { success: true, data: draft };
  }

  @Get()
  async list(@CurrentUser() user: any) {
    const userId = user._id?.toString() ?? user.id?.toString();
    const drafts = await this.draftsService.getUserDrafts(userId);
    return { success: true, data: drafts };
  }

  @Get(':draftKey')
  async get(@CurrentUser() user: any, @Param('draftKey') draftKey: string) {
    const userId = user._id?.toString() ?? user.id?.toString();
    const draft = await this.draftsService.get(userId, draftKey);
    return { success: true, data: draft ?? null };
  }

  @Delete(':draftKey')
  async discard(@CurrentUser() user: any, @Param('draftKey') draftKey: string) {
    const userId = user._id?.toString() ?? user.id?.toString();
    await this.draftsService.discard(userId, draftKey);
    return { success: true, message: 'Draft discarded' };
  }
}
