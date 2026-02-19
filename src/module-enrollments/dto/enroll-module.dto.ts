import { IsString, IsNotEmpty } from 'class-validator';

export class EnrollModuleDto {
  @IsString()
  @IsNotEmpty()
  moduleId: string;
}
