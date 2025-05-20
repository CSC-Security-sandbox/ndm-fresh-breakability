import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'Array of user emails' })
  @IsEmail({}, { each: true })
  email: string;

  @ApiProperty({ description: 'Status of the user', default: 'active' })
  @IsString()
  first_name: string;

  @ApiProperty({ description: 'Status of the user', default: 'active' })
  @IsString()
  last_name: string;

  @ApiProperty({ description: 'Status of the user', default: 'active' })
  @IsString()
  user_status: string;
}
