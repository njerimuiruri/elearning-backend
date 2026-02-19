import { IsString, IsOptional, IsBoolean, IsEnum, IsArray, IsNumber } from 'class-validator';
import { AccessType } from '../../schemas/category.schema';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(AccessType)
  accessType?: AccessType;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedRoles?: string[];

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsBoolean()
  paymentRequiredForNonEligible?: boolean;

  @IsOptional()
  @IsString()
  courseDescription?: string;

  @IsOptional()
  @IsString()
  overallObjectives?: string;

  @IsOptional()
  @IsString()
  learningOutcomes?: string;

  @IsOptional()
  @IsString()
  academicStructure?: string;

  @IsOptional()
  @IsString()
  progressionFramework?: string;

  @IsOptional()
  @IsString()
  fellowshipLevels?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(AccessType)
  accessType?: AccessType;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedRoles?: string[];

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsBoolean()
  paymentRequiredForNonEligible?: boolean;

  @IsOptional()
  @IsString()
  courseDescription?: string;

  @IsOptional()
  @IsString()
  overallObjectives?: string;

  @IsOptional()
  @IsString()
  learningOutcomes?: string;

  @IsOptional()
  @IsString()
  academicStructure?: string;

  @IsOptional()
  @IsString()
  progressionFramework?: string;

  @IsOptional()
  @IsString()
  fellowshipLevels?: string;
}
