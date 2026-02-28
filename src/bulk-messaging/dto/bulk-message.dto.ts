import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  Min,
  IsIn,
} from 'class-validator';
import { BulkReminderFilterType } from '../../schemas/bulk-reminder.schema';

export class SendInstructorReminderDto {
  @IsString()
  @IsNotEmpty()
  moduleId: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsEnum(BulkReminderFilterType)
  filterType: BulkReminderFilterType;

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
  recipientType: 'students' | 'instructors';

  @IsOptional()
  @IsString()
  moduleId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  message: string;

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
