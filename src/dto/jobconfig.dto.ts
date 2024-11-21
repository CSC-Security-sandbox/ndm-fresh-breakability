import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsIn,
  IsArray,
  IsUUID,
  IsDateString,
} from 'class-validator';

export enum JobType {
  Discovery = 'DISCOVERY',
  Migrate = 'MIGRATE',
  CutOver = 'CUTOVER',
  SpeedTest = 'SPEEDTEST'
}

export class JobConfigDTO {
  @ApiProperty({
    example: 'DISCOVERY',
    description: 'Type of the job',
    default: JobType.Discovery,
    enum: JobType,
  })
  @IsIn(Object.values(JobType))
  jobType: JobType;

  @ApiProperty({ example: '1234', description: 'Unique identifier for the file server' })
  @IsUUID()
  fileServerId: string;

  @ApiProperty({ example: ['path/to/source1', 'path/to/source2'], description: 'Array of paths to be discovered/migrated' })
  @IsArray()
  pathList: string[];

  @ApiProperty({ description: 'Schedule configuration for the job' })
  @IsDateString()
  jobSchedule: Date;

  @ApiProperty({ description: 'Created by user' })
  @IsString()
  created_by: string;

  @ApiProperty({ description: 'Updated by user' })
  @IsString()
  updated_by: string;
}


