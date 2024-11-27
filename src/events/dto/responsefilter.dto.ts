import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { Operations, ResponseStatus, TaskType } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';


export class WorkerRequestDTO {
  @ApiPropertyOptional({ description: 'Page number for pagination', example: '1' })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', example: '10' })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Field to sort by', example: 'createdAt', enum: ['requestType', 'status', 'createdAt', 'workerId', 'createdAt', 'updatedAt'] })
  @IsOptional()
  @IsIn(['requestType', 'status', 'createdAt', 'workerId', 'createdAt', 'updatedOn'])
  sort?: string;

  @ApiPropertyOptional({ description: 'Order of sorting', example: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'WorkerCommand of the request',
    example: TaskType.VALIDATE_CONNECTION,
    enum: TaskType,
  })
  @IsOptional()
  @IsIn(Object.values(TaskType))
  taskType?: TaskType;

  @ApiPropertyOptional({
    description: 'Status of the response',
    example: ResponseStatus.PENDING,
    enum: ResponseStatus,
  })
  @IsOptional()
  @IsIn(Object.values(ResponseStatus))
  status?: ResponseStatus;

  @ApiPropertyOptional({
    description: 'Operation of the request',
    example: Operations.VALIDATE_NFS_CONNECTION,
    enum: Operations,
  })
  @IsOptional()
  @IsIn(Object.values(Operations))
  operation?: Operations;

  @ApiPropertyOptional({ description: 'Field to Filter transactionId' })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter workerId' })
  @IsOptional()
  @IsString()
  workerId?: string;

  @ApiPropertyOptional({ description: 'Deserialize JSON', example: 'false' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => typeof value == 'string' ? value === 'true' :  value)
  deserialize?: boolean; 
}


export class WorkerResponseDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => RequestTrackEntity, description: 'RequestTrack object' })
  data: RequestTrackEntity[];
}
