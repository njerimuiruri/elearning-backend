import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ProgressionService } from '../progression.service';
import { ModulesService } from '../../modules/modules.service';

@Injectable()
export class LevelAccessGuard implements CanActivate {
  constructor(
    private progressionService: ProgressionService,
    private modulesService: ModulesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const moduleId = request.params.moduleId || request.body.moduleId;

    if (!moduleId) {
      throw new ForbiddenException('Module ID required');
    }

    // Get module to check level
    const module = await this.modulesService.getModuleById(moduleId);
    if (!module) {
      throw new ForbiddenException('Module not found');
    }

    // Check level access
    const canAccess = await this.progressionService.canAccessLevel(
      user.id,
      module.categoryId.toString(),
      module.level,
    );

    if (!canAccess) {
      const previousLevel = this.getPreviousLevel(module.level);
      throw new ForbiddenException(
        `You must complete all ${previousLevel} level modules before accessing ${module.level} level modules`,
      );
    }

    return true;
  }

  private getPreviousLevel(level: string): string {
    if (level === 'intermediate') return 'beginner';
    if (level === 'advanced') return 'intermediate';
    return '';
  }
}
