import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';
import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';

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
  @IsEnum(Protocol) 
  @IsOptional()
  protocol?: Protocol;

  @ApiProperty({ description: 'Hostname or IP of the file server', example: '192.168.1.100' })
  @IsString()
  @IsOptional()
  hostname?: string;

  @ApiPropertyOptional({ description: 'Directory within export (optional)', example: 'subdir1' })
  @IsString()
  @IsOptional()
  dir?: string;

  @ApiPropertyOptional({ description: 'Username for SMB authentication', example: 'user' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: 'Password for SMB authentication', example: 'password' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ description: 'Protocol version (e.g., v3, v4 for NFS)', example: 'v4' })
  @IsString()
  @IsOptional()
  protocolVersion?: string;
}