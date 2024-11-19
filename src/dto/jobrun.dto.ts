import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsString, IsNumber, IsOptional, IsDateString } from 'class-validator';

export class JobRunDto {
  @ApiProperty({ description: 'UUID of the job run' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Job run status' })
  @IsString()
  status: string;

  @ApiProperty({ description: 'Start time of the job' })
  @IsDateString()
  start_time: Date;

  @ApiProperty({ description: 'End time of the job' })
  @IsDateString()
  @IsOptional()
  end_time: Date;

  @ApiProperty({ description: 'Iteration number of the job' })
  @IsNumber()
  iteration_number: number;

  @ApiProperty({ description: 'Job ID associated with this run' })
  @IsOptional()
  @IsNumber()
  job_id: string;
}

export class JobRunFilterDto {
  @ApiPropertyOptional({ description: 'Filter by job ID', example: '1234' })
  @IsOptional()
  @IsString()
  job_id?: string;

  @ApiPropertyOptional({ description: 'Filter by status', example: 'running' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by start time', example: '2024-11-13T12:00:00Z' })
  @IsOptional()
  @IsDateString()
  start_time?: string;

  @ApiPropertyOptional({ description: 'Filter by end time', example: '2024-11-14T12:00:00Z' })
  @IsOptional()
  @IsDateString()
  end_time?: string;

  @ApiPropertyOptional({ description: 'Filter by iteration number', example: 1 })
  @IsOptional()
  @IsNumber()
  iteration_number?: number;
}