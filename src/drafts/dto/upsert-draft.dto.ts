import { IsString, IsOptional } from 'class-validator';

export class UpsertDraftDto {
  @IsString()
  contentType!: string;

  data: any;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  title?: string;
}
