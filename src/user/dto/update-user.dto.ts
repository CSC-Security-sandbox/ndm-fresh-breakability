import { PartialType } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional() 
  @IsEmail() 
  email?: string;

  @IsOptional()
  @IsString()
  user_status?: string;
}
