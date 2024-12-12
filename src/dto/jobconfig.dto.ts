import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDate, IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { JobStatus, JobType } from 'src/constants/enums';

export class IdMapping {
  @ApiProperty({ description: 'UUID of the source mapping' })
  @IsUUID()
  sourceId: number;

  @ApiProperty({ description: 'UUID of the destination mapping' })
  @IsUUID()
  destinationId: number;
}
export class CreateJobConfigDto {
  @ApiProperty({ description: 'Job type, e.g., discovery', enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty({ description: 'Status of the job', enum: JobStatus })
  @IsEnum(JobStatus)
  status: JobStatus;

  @ApiProperty({ description: 'Exclude files older than this date', required: false })
  @IsOptional()
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ description: 'Patterns of files to exclude', required: false })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ description: 'Preserve access time flag', default: false })
  @IsOptional()
  @IsBoolean()
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Job schedule configuration' })
  @IsObject()
  firstRunAt: Date;

  @ApiProperty({ description: 'Incremental job schedule configuration' })
  @IsObject()
  futureScheduleAt: string;

  @ApiProperty({ description: 'UUID of the source path configuration' })
  @IsUUID()
  sourcePathId: string;

  @ApiProperty({ description: 'UUID of the target path configuration' })
  @IsOptional()
  @IsUUID()
  targetPathId: string;

  @ApiProperty({ description: 'Created by user ID', required: false })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiProperty({ description: 'Updated by user ID', required: false })
  @IsOptional()
  @IsString()
  updatedBy?: string;
}