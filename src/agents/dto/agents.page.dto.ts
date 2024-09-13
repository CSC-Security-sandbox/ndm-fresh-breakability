import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { AgentStatus } from 'src/constants/enums';
import { AgentEntity } from 'src/entities/agent.entity';

export class AgentsStatusPageDto {
  @ApiPropertyOptional({ description: 'Page number for pagination', example: '1' })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', example: '10' })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Field to sort by', example: 'createdAt', enum: ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'] })
  @IsOptional()
  @IsIn(['createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
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

  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of agentName', enum: AgentStatus})
  @IsOptional()
  @IsIn(Object.values(AgentStatus))
  status?: AgentStatus;

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
  @ApiProperty({ type: () => AgentEntity, description: 'AgentEntity object' })
  data: AgentEntity[];
}