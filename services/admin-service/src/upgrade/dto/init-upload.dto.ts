import { IsString, IsNumber, IsIn, Min, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitUploadDto {
  @ApiProperty({ 
    description: 'Original filename of the upgrade bundle',
    example: 'ndm-upgrade-v2.1.0.tar.gz'
  })
  @IsString()
  @Matches(/\.(tar\.gz|zip)$/, { 
    message: 'File must be .tar.gz or .zip' 
  })
  fileName: string;

  @ApiProperty({ 
    description: 'Total file size in bytes',
    example: 12884901888  // 12GB
  })
  @IsNumber()
  @Min(1)
  fileSize: number;

  @ApiProperty({ 
    description: 'SHA256 checksum of the entire file',
    example: 'a1b2c3d4e5f6...'
  })
  @IsString()
  checksum: string;
}

export class InitUploadResponseDto {
  @ApiProperty({ description: 'Unique upload session ID' })
  uploadId: string;

  @ApiProperty({ description: 'Size of each chunk in bytes (100MB)' })
  chunkSize: number;

  @ApiProperty({ description: 'Total number of chunks expected' })
  totalChunks: number;
}