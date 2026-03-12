import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { JobRunStatus } from 'src/constants/enums';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { WorkerEntity } from 'src/entities/worker.entity';

export class JobRunPageDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: '1',
  })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: '10',
  })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
  sort?: string;

  @ApiPropertyOptional({
    description: 'Order of sorting',
    example: 'asc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'id of Job Run' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ description: 'JobConfig Id' })
  @IsOptional()
  @IsUUID()
  jobConfigId?: string;

  @ApiPropertyOptional({ description: 'Iteration Number' })
  @IsOptional()
  @IsNumber()
  iterationNumber?: number;

  @ApiPropertyOptional({ description: 'Status of job Run', enum: JobRunStatus })
  @IsOptional()
  @IsIn(Object.values(JobRunStatus))
  status?: JobRunStatus;

  @ApiPropertyOptional({ description: 'Start Time' })
  @IsOptional()
  @IsDateString()
  startTime?: Date;

  @ApiPropertyOptional({ description: 'End Time' })
  @IsOptional()
  @IsDateString()
  endTime?: Date;

  @ApiPropertyOptional({ description: 'Project Id' })
  @IsUUID()
  projectId: string;
}

export class JobRunPageResponseDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => WorkerEntity, description: 'WorkerEntity object' })
  data: JobRunEntity[];
}
