import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { Protocol } from 'src/constants/enums';
import { RequestType, ResponseStatus } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';


export class ResponsePageFilterDto {
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
    description: 'RequestType of the response',
    example: RequestType.TestConnection,
    enum: RequestType,
  })
  @IsOptional()
  @IsIn(Object.values(RequestType))
  requestType?: RequestType;

  @ApiPropertyOptional({
    description: 'Status of the response',
    example: ResponseStatus.Pending,
    enum: ResponseStatus,
  })
  @IsOptional()
  @IsIn(Object.values(ResponseStatus))
  status?: ResponseStatus;

  @ApiPropertyOptional({
    description: 'Protocol of the response',
    example: Protocol.NFS,
    enum: Protocol,
  })
  @IsOptional()
  @IsIn(Object.values(Protocol))
  protocol?: Protocol;


  @ApiPropertyOptional({ description: 'Field to Filter requestId' })
  @IsOptional()
  @IsString()
  requestId?: string;

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


export class ResponsePageFilterResponseDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => RequestTrackEntity, description: 'RequestTrack object' })
  data: RequestTrackEntity[];
}
