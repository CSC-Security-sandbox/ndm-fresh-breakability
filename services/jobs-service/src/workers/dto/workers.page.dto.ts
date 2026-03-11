import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { WorkerStatus } from 'src/constants/enums';
import { WorkerEntity } from 'src/entities/worker.entity';

export class WorkersStatusPageDto {
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

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of workerId' })
  @IsOptional()
  @IsString()
  workerId?: string;

  @ApiPropertyOptional({
    description: 'Field to Filter ObjectId of workerName',
  })
  @IsOptional()
  @IsString()
  workerName?: string;

  @ApiPropertyOptional({
    description: 'Field to Filter ObjectId of workerName',
  })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({
    description: 'Field to Filter ObjectId of workerName',
    enum: WorkerStatus,
  })
  @IsOptional()
  @IsIn(Object.values(WorkerStatus))
  status?: WorkerStatus;

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of projectId' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of clientId' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter Worker by jobRunId' })
  @IsOptional()
  @IsString()
  jobRunId?: string;

  @ApiPropertyOptional({
    description: 'Field to Filter Worker by fileServerId',
  })
  @IsOptional()
  @IsString()
  fileServerId?: string;
}

export class WorkerStatusPageResponseDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => WorkerEntity, description: 'WorkerEntity object' })
  data: WorkerEntity[];
}
