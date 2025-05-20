import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRolePermissionDto {
  @ApiProperty({ description: 'Role Id for which project is to be created' })
  @IsString()
  role_id: string;

  @ApiProperty({
    description: 'Permission Id for which project is to be created',
  })
  @IsString()
  permission_id: string;
}
