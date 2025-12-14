import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../../schemas/user.schema';

export class GoogleLoginDto {
  @IsString()
  idToken: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
