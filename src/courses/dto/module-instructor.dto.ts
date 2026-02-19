import { IsString, IsNotEmpty, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ModuleInstructorRole } from '../../schemas/module-instructor.schema';

export class ModuleInstructorDto {
  @IsString()
  @IsNotEmpty()
  instructorId: string;

  @IsEnum(ModuleInstructorRole)
  role: ModuleInstructorRole;

  @IsObject()
  permissions: {
    canEditLessons: boolean;
    canAddQuizzes: boolean;
    canUploadResources: boolean;
    canReviewContent: boolean;
    canPublish?: boolean;
    canDelete?: boolean;
    canRemoveInstructors?: boolean;
  };
}
