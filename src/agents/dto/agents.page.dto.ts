import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsMongoId, IsNumberString, IsOptional, IsString } from 'class-validator';
import { AgentStatus } from 'src/schemas/Agent.schema';

export class AgentsStatusPageDto {
  @ApiPropertyOptional({ description: 'Page number for pagination', example: '1' })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', example: '10' })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Field to sort by', example: 'createdOn', enum: ['userName', 'email', 'createdOn', 'createdBy', 'updateAt', 'updatedBy'] })
  @IsOptional()
  @IsIn(['userName', 'email', 'createdOn', 'createdBy', 'updateAt', 'updatedBy'])
  sort?: string;

  @ApiPropertyOptional({ description: 'Order of sorting', example: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of agentId'})
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of agentName'})
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of agentName'})
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of agentName', enum: ['Active', 'Inactive'] })
  @IsOptional()
  @IsIn(['Active', 'Inactive'])
  status?: 'Active' | 'Inactive';

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of projectId'})
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of clientId'})
  @IsOptional()
  @IsString()
  clientId?: string;

}


export class AgentsStatusPageResponceDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => AgentStatus, description: 'User object' })
  data: AgentStatus[];
}