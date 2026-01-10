import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class JobConfigInventoryStatsRequestDto {
  @ApiProperty({ 
    description: 'Job Configuration ID', 
    example: '123e4567-e89b-12d3-a456-426614174000' 
  })
  @IsUUID()
  jobConfigID: string;
}

export class JobConfigInventoryStatsResponseDto {
  @ApiProperty({ description: 'Total number of unique files' })
  totalUniqueFiles: number;

  @ApiProperty({ description: 'Total number of unique directories' })
  totalUniqueDirectories: number;

  @ApiProperty({ description: 'Total size of all files in bytes' })
  totalSize: string;

  @ApiProperty({ description: 'Last updated timestamp', example: new Date().toISOString() })
  lastUpdatedAt: Date;
}
