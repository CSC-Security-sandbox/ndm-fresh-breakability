import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePermissionDto {
  @ApiProperty({ description: 'Name of permission to be created' })
  @IsString()
  permission_name: string;
}
