import { IsString, IsNotEmpty } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;
}

export class CreateModulePaymentDto {
  @IsString()
  @IsNotEmpty()
  moduleId: string;
}

export class VerifyPaymentDto {
  @IsString()
  @IsNotEmpty()
  reference: string;
}
