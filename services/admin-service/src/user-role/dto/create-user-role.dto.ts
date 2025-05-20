import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserRoleDto {
  @ApiProperty({ description: 'User Id for which project is to be created' })
  @IsString()
  user_id: string;

  @ApiProperty({ description: 'Role Id for which project is to be created' })
  @IsString()
  role_id: string;

  @ApiProperty({ description: 'Project Id for which project is to be created' })
  @IsString()
  project_id: string;

  @ApiProperty({ description: 'Account Id for which project is to be created' })
  @IsString()
  account_id: string;
}
