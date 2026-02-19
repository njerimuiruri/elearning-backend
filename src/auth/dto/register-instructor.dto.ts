import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterInstructorDto {
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
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsString()
  @IsOptional()
  organization?: string;

  @IsString()
  @IsOptional()
  otherOrganization?: string;

  @IsString()
  @IsNotEmpty()
  institution: string;

  @IsString()
  @IsNotEmpty()
  bio: string;

  @IsString()
  @IsNotEmpty()
  qualifications: string;

  @IsString()
  @IsNotEmpty()
  expertise: string;

  @IsOptional()
  @IsString()
  linkedIn?: string;

  @IsOptional()
  @IsString()
  portfolio?: string;

  @IsString()
  @IsNotEmpty()
  teachingExperience: string;

  @IsString()
  @IsNotEmpty()
  yearsOfExperience: string;

  @IsOptional()
  profilePicture?: any; // For file uploads

  @IsOptional()
  @IsString()
  profilePictureUrl?: string;

  @IsOptional()
  cv?: any; // For file uploads

  @IsOptional()
  @IsString()
  cvUrl?: string;
}