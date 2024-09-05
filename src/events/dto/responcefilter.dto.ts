import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { RequestType, ResponseStatus } from 'src/constants/status';
import { RequestTrack } from 'src/schemas/RequestTrack.schema';

export class ResponsePageFilterDto {
  @ApiPropertyOptional({ description: 'Page number for pagination', example: '1' })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', example: '10' })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Field to sort by', example: 'created_at', enum: ['requestType', 'status', 'createdOn', 'agentId', 'created_at', 'updated_at'] })
  @IsOptional()
  @IsIn(['requestType', 'status', 'createdOn', 'agentId', 'created_at', 'updated_at'])
  sort?: string;

  @ApiPropertyOptional({ description: 'Order of sorting', example: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';


  @ApiPropertyOptional({ 
    description: 'RequestType of the response', 
    example: RequestType.TestConnection, 
    enum: RequestType 
  })
  @IsOptional()
  @IsIn(Object.values(RequestType))
  requestType?: RequestType;

  @ApiPropertyOptional({ 
    description: 'Status of the response', 
    example: ResponseStatus.Pending, 
    enum: ResponseStatus 
  })
  @IsOptional()
  @IsIn(Object.values(ResponseStatus))
  status?: ResponseStatus;

  @ApiPropertyOptional({ description: 'Field to Filter requestId'})
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter agentId'})
  @IsOptional()
  @IsString()
  agentId?: string;

}

export class ResponsePageFilterResponseDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => RequestTrack, description: 'RequestTrack object' })
  data: RequestTrack[];
}
