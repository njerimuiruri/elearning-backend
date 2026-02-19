import { IsArray, IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AnswerDto {
  @IsNumber()
  questionIndex: number;

  @IsString()
  @IsNotEmpty()
  answer: string;
}

export class SubmitLessonAssessmentDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}

export class SubmitFinalAssessmentDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}
