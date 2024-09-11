import { IsArray, ArrayNotEmpty, IsString, ValidateNested, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Protocol } from 'constants/enums';


class AgentDetails {
  @ApiProperty({ description: 'Agent ID', example: 'agentId' })
  @IsString()
  @IsNotEmpty()   
  agentId: string;
}

export class MountConnectionsDTO {
  @ApiProperty({
    description: 'List of agent details',
    type: [AgentDetails],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AgentDetails)
  agents: AgentDetails[];


  @ApiProperty({
    description: 'List of protocals',
    enum: Protocol,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  protocol: Protocol[];

  @ApiPropertyOptional({description: 'configId'})
  @IsOptional()
  @IsString()
  configId: string

}
