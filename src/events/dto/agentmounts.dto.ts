import { IsArray, ArrayNotEmpty, IsString, ValidateNested, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';


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

}
