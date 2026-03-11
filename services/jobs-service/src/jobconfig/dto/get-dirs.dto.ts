import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional } from 'class-validator';

export class GetDirsDto {
  @ApiProperty({
    description:
      'File Server ID (protocol, host, and version come from this stored server)',
  })
  @IsUUID()
  fileServerId: string;

  @ApiProperty({
    description: 'Export path on the file server',
    example: '/ifs/data',
  })
  @IsString()
  exportPath: string;

  @ApiPropertyOptional({
    description: 'Relative path within export (empty for root)',
    example: '/subdir1',
  })
  @IsString()
  @IsOptional()
  path?: string;

  @ApiPropertyOptional({
    description: 'Directory within export (optional)',
    example: 'subdir1',
  })
  @IsString()
  @IsOptional()
  dir?: string;
}
