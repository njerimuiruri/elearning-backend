import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  Min,
  IsIn,
  IsEmail,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BulkReminderFilterType } from '../../schemas/bulk-reminder.schema';
import { BulkEmailFilterType } from '../../schemas/bulk-email.schema';

export class SendInstructorReminderDto {
  @IsString()
  @IsNotEmpty()
  moduleId!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsEnum(BulkReminderFilterType)
  filterType!: BulkReminderFilterType;

  @IsOptional()
  @IsNumber()
  @Min(1)
  inactiveDays?: number;

  /** If provided, overrides filterType and sends only to these studentIds */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}

export class SendAdminReminderDto {
  @IsIn(['students', 'instructors'])
  recipientType!: 'students' | 'instructors';

  @IsOptional()
  @IsString()
  moduleId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  @IsEnum(BulkReminderFilterType)
  filterType?: BulkReminderFilterType;

  @IsOptional()
  @IsNumber()
  @Min(1)
  inactiveDays?: number;

  /** If provided, sends only to these specific student or instructor IDs */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specificIds?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK EMAIL DTOs (Admin composed bulk email feature)
// ─────────────────────────────────────────────────────────────────────────────

export class CcBccEntryDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class BulkEmailAttachmentDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsOptional()
  @IsNumber()
  size?: number;
}

export class SendBulkEmailDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  body!: string; // HTML content from rich-text editor

  @IsEnum(BulkEmailFilterType)
  filterType!: BulkEmailFilterType;

  /** Category IDs when filterType = BY_CATEGORY */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterCategoryIds?: string[];

  /** Cohort names when filterType = BY_COHORT */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterCohorts?: string[];

  /** Explicit user IDs when filterType = MANUAL */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  manualUserIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CcBccEntryDto)
  cc?: CcBccEntryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CcBccEntryDto)
  bcc?: CcBccEntryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkEmailAttachmentDto)
  attachments?: BulkEmailAttachmentDto[];
}

export class PreviewRecipientsDto {
  @IsEnum(BulkEmailFilterType)
  filterType!: BulkEmailFilterType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterCohorts?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  manualUserIds?: string[];
}
