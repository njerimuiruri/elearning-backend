import {
  IsString,
  IsEmail,
  IsArray,
  IsMongoId,
  IsOptional,
  IsBoolean,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class SavePdfTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  pdfUrl!: string;

  @IsString()
  pdfPublicId!: string;

  @IsOptional()
  @IsString()
  originalFileName?: string;
}

export class CreateFromEmailDto {
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  email!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SendAdmissionLettersDto {
  @IsMongoId()
  templateId!: string;

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsEmail()
  fromEmail!: string;

  @IsString()
  @MinLength(1)
  fromName!: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((e: string) => e?.toLowerCase()?.trim()).filter(Boolean)
      : [],
  )
  ccEmails?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  recipientIds!: string[];

  @IsString()
  signOffName!: string;

  @IsString()
  signOffTitle!: string;
}
