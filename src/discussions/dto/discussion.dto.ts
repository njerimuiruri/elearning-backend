import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateDiscussionDto {
  @IsString()
  @IsNotEmpty()
  moduleId: string;

  @IsNumber()
  @IsOptional()
  lessonIndex?: number;

  @IsString()
  @IsOptional()
  lessonTitle?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class AddReplyDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
