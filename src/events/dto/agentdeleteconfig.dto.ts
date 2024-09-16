import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';


class AgentDetails {
  @ApiProperty({ description: 'Agent ID', example: 'agentId' })
  @IsString()
  @IsNotEmpty()   
  agentId: string;
}

export class DeleteConnectionsDTO {
  @ApiProperty({
    description: 'List of agent details',
    type: [AgentDetails],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AgentDetails)
  agents: AgentDetails[];

  @ApiPropertyOptional({description: 'configId'})
  @IsOptional()
  @IsString()
  configId: string

}
