import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JobStatus, JobType } from 'src/constants/enums';

export class JobConfigDto {
  @ApiProperty({ description: 'Job type, e.g., discovery', example: JobType.CutOver })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty({ description: 'Status of the job', example: JobStatus.Active })
  @IsEnum(JobStatus)
  status: JobStatus;

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
  @IsBoolean()
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Job schedule configuration', example: new Date().toISOString() })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt: Date;

  @ApiProperty({ description: 'Incremental job schedule configuration' })
  @IsOptional()
  @IsString()
  futureSchedule?: string;

  @ApiProperty({ description: 'UUID of the source path configuration' })
  @IsUUID()
  sourcePathId: string;

  @ApiProperty({ description: 'UUID of the target path configuration', required: false })
  @IsOptional()
  @IsUUID()
  targetPathId?: string;

  @ApiProperty({ description: 'UUID of createdBy', required: false })
  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @ApiProperty({ description: 'UUID of createdBy', required: false })
  @IsOptional()
  @IsUUID()
  updatedBy?: string;
}
