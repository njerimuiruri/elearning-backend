import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;
}

export class CreateModulePaymentDto {
  @IsString()
  @IsNotEmpty()
  moduleId: string;

  @IsOptional()
  @IsEnum(['student', 'non-student'])
  userTier?: 'student' | 'non-student';
}

export class CreateCategoryPaymentDto {
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsEnum(['student', 'non-student'])
  userTier: 'student' | 'non-student';

  @IsEnum(['full', 'installment1', 'installment2'])
  paymentOption: 'full' | 'installment1' | 'installment2';
}

export class VerifyPaymentDto {
  @IsString()
  @IsNotEmpty()
  reference: string;
}
