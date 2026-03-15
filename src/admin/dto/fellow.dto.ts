import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsArray,
  IsOptional,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFellowDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  gender?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsOptional()
  track?: string;

  @IsString()
  @IsOptional()
  category?: string; // category ID to assign

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean; // send invitation email immediately (default: false — save now, email later)
}

export class BulkCreateFellowsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFellowDto)
  fellows: CreateFellowDto[];

  @IsBoolean()
  @IsOptional()
  sendEmails?: boolean; // send invitation emails to all created fellows
}

export class BulkSendEmailDto {
  @IsArray()
  fellowIds: string[];

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsArray()
  @IsOptional()
  cc?: string[];

  @IsArray()
  @IsOptional()
  bcc?: string[];
}
