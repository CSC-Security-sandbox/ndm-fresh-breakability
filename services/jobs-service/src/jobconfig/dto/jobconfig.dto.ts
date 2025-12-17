import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString
} from 'class-validator';
import { JobStatus } from 'src/constants/enums';

export class JobConfigDto {
  @ApiProperty({ description: 'Status of the job', example: JobStatus.Active })
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiProperty({ description: 'Exclude files older than this date', required: false, })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ description: 'Patterns of files to exclude', required: false , })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ description: 'Preserve access time flag', example: false})
  @IsOptional()
  @IsBoolean()
  preserveAccessTime?: boolean;

  @ApiProperty({ description: 'Scan Alternate Data Streams flag (Windows/SMB only)', example: false, required: false })
  @IsOptional()
  @IsBoolean()
  shouldScanADS?: boolean;

  @ApiProperty({ description: 'Job schedule configuration', example: new Date().toISOString() })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt?: Date;

  @ApiProperty({ description: 'Incremental job schedule configuration' })
  @IsOptional()
  @IsString()
  futureSchedule?: string;
}
