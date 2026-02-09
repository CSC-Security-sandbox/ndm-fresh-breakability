import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';
import { IsString, IsUUID, IsOptional } from 'class-validator';

export class GetDirsDto {
  @ApiProperty({ description: 'File Server ID' })
  @IsUUID()
  fileServerId: string;

  @ApiProperty({ description: 'Export path on the file server', example: '/ifs/data' })
  @IsString()
  exportPath: string;

  @ApiPropertyOptional({ description: 'Relative path within export (empty for root)', example: '/subdir1' })
  @IsString()
  @IsOptional()
  path?: string;

  @ApiProperty({ description: 'Protocol used to access the file server', example: 'Protocol.NFS' })
  protocol: Protocol;
}