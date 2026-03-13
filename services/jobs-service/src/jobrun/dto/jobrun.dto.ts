import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { JobRunStatus } from 'src/constants/enums';

export class JobRunDto {
  @ApiProperty({ description: 'UUID of the job run' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Job run status' })
  @IsString()
  status: JobRunStatus;

  @ApiProperty({ description: 'Start time of the job' })
  @IsDateString()
  startTime: Date;

  @ApiPropertyOptional({ description: 'End time of the job' })
  @IsDateString()
  @IsOptional()
  endTime: Date;

  @ApiProperty({ description: 'Iteration number of the job' })
  @IsNumber()
  iterationNumber: number;

  @ApiProperty({ description: 'Job Config ID associated with this run' })
  @IsUUID()
  jobConfigId: string;
}

export class JobRunFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by Job Config ID',
    example: '1234',
  })
  @IsOptional()
  @IsUUID()
  jobConfigId?: string;

  @ApiPropertyOptional({ description: 'Filter by Project ID', example: '1234' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by status', example: 'running' })
  @IsOptional()
  @IsString()
  status?: JobRunStatus;

  @ApiPropertyOptional({
    description: 'Filter by start time',
    example: '2024-11-13T12:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiPropertyOptional({
    description: 'Filter by end time',
    example: '2024-11-14T12:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional({
    description: 'Filter by iteration number',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  iterationNumber?: number;
}

export interface JobRunsDTO {
  lastRefreshed?: Date | null;
  jobRunId: string;
  status: string;
  startTime: Date;
  endTime?: Date | null;
  jobConfigId?: string;
  jobType: string;
  jobRunType: string;
  sourceServer: ServerDetailsDTO;
  destinationServer?: ServerDetailsDTO | Record<string, never>;
  nextSchedule?: Date | string | null;
  timeElapsed: number;
  scannedFilesCount: string;
  scannedDirectoriesCount: string;
  totalScannedSize: string;
  errors: { errorType?: string; errortype?: string; count: number }[];
  totalMigratedSize: string;
  isReportReady: boolean;
}

export interface ServerDetailsDTO {
  serverName: string;
  path: string;
  directoryPath?: string;
  protocol: string;
}

export interface JobRunDetailsDTO {
  jobRunId: string;
  jobConfigId: string;
  status: string;
  startTime: Date;
  endTime?: Date;
  jobType: string;
  jobRunType: string;
  sourceServer: ServerDetailsDTO;
  destinationServer?: ServerDetailsDTO;
  timeElapsed: number;
  scannedFilesCount: string;
  scannedDirectoriesCount: string;
  totalScannedSize: string;
  errors: unknown[];
  tasks: TaskDTO[];
  totalMigratedSize: string;
}
export interface TaskDTO {
  taskId: string;
  taskType: string;
  status: string;
  startTime: Date;
  endTime?: Date;
  worker: string;
  errors: string[];
}
