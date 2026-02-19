import { IsString, IsNotEmpty, IsEmail, IsOptional, IsNumber } from 'class-validator';

export class CreateInstructorDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  organization?: string;

  @IsString()
  @IsOptional()
  institution?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsString()
  @IsOptional()
  qualifications?: string;

  @IsString()
  @IsOptional()
  expertise?: string;

  @IsString()
  @IsOptional()
  linkedIn?: string;

  @IsString()
  @IsOptional()
  portfolio?: string;

  @IsString()
  @IsOptional()
  teachingExperience?: string;

  @IsString()
  @IsOptional()
  yearsOfExperience?: string;

  // Files will be handled by multer interceptor
  profilePicture?: any;
  cv?: any;
}
