import { IsArray, ArrayNotEmpty, IsString, ValidateNested, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Protocal } from 'constants/enums';


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
    enum: Protocal,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => AgentDetails)
  protocal: Protocal[];

}
