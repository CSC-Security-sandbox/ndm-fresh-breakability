import { IsString, IsNumber, Min, Matches, Max, IsArray, IsUUID, ArrayMaxSize, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════
// INIT UPLOAD DTOs
// ═══════════════════════════════════════════════════════════════

export class InitUploadDto {
  @ApiProperty({ 
    description: 'Original filename of the upgrade bundle',
    example: 'upgrade-v2.1.0.tar.gz'
  })
  @IsString()
  @Matches(/\.tar\.gz$/, { 
    message: 'File must be .tar.gz' 
  })
  fileName: string;

  @ApiProperty({ 
    description: 'Total file size in bytes',
    example: 12884901888  // 12GB
  })
  @IsNumber()
  @Min(1 * 1024 * 1024)
  @Max(20 * 1024 * 1024 * 1024)
  fileSize: number;
}

export class InitUploadResponseDto {
  @ApiProperty({ description: 'Unique upload session ID' })
  uploadId: string;

  @ApiProperty({ description: 'Size of each chunk in bytes (15MB)' })
  chunkSize: number;

  @ApiProperty({ description: 'Total number of chunks expected' })
  totalChunks: number;
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD CHUNK DTOs
// ═══════════════════════════════════════════════════════════════

export class UploadChunkResponseDto {
  @ApiProperty({ description: 'Whether chunk was received successfully' })
  received: boolean;

  @ApiProperty({ description: 'Index of the received chunk' })
  chunkIndex: number;

  @ApiProperty({ description: 'Bytes received for this chunk' })
  bytesReceived: number;
}

// ═══════════════════════════════════════════════════════════════
// SAVE STOPPED JOB IDs DTO
// ═══════════════════════════════════════════════════════════════

export class SaveStoppedJobIdsDto {
  @ApiPropertyOptional({ description: 'Deactivated job config IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(1000)
  deactivatedConfigIds?: string[];

  @ApiPropertyOptional({ description: 'Stopped job run IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(1000)
  stoppedRunIds?: string[];
}
