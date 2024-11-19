import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsUUID,
  IsIn,
} from 'class-validator';

export class JobConfigDTO {
  @ApiProperty({
    example: 'Discover',
    description: 'Type of the job',
    enum: ['discover', 'migrate', 'cutover', 'speedtest'],
  })
  @IsIn(['discover', 'migrate', 'cutover', 'speedtest'])
  jobType: string;

  @ApiProperty({ example: '1234', description: 'Unique identifier for the file server' })
  @IsString()
  fileServerId: string;

  @ApiProperty({ example: ['path/to/source1', 'path/to/source2'], description: 'Array of paths to be discovered/migrated' })
  @IsString()
  pathList: string[];

  @ApiProperty({ description: 'Schedule configuration for the job' })
  jobSchedule: Date;

  @ApiProperty({ description: 'Created by user' })
  @IsString()
  created_by: string;

  @ApiProperty({ description: 'Updated by user' })
  @IsString()
  updated_by: string;
}


