import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { AgentEntity } from 'src/entities/agent.entity';
import { ConfigEntity } from 'src/entities/config.entity';

export class FindallConfigPageDto {
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
  
  @ApiPropertyOptional({ description: 'Field to Filter ObjectId of projectId'})
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Field to Filter configName'})
  @IsOptional()
  @IsString()
  configName?: string;

  @ApiPropertyOptional({ description: 'Field to Filter stage'})
  @IsOptional()
  @IsString()
  stage?: string;

}


export class ConfigResponceDto {
  @ApiProperty()
  total: string;
  @ApiProperty({ type: () => AgentEntity, description: 'AgentEntity object' })
  data: ConfigEntity[];
}