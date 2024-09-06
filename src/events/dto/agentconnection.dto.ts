import { IsArray, ArrayNotEmpty, IsString, ValidateNested, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class ConnectionDetails {
  @ApiProperty({ description: 'Username of connection', example: 'username' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ description: 'Password of connection', example: 'password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'Host of connection', example: 'host' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ description: 'Protocol of connection', example: 'protocol' })
  @IsString()
  @IsNotEmpty()
  protocol: string;
}

class AgentDetails {
  @ApiProperty({ description: 'Agent ID', example: 'agentId' })
  @IsString()
  @IsNotEmpty()
  agentId: string;
}

export class TestConnectionsDTO {
  @ApiProperty({
    description: 'List of agent details',
    type: [AgentDetails],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AgentDetails)
  agents: AgentDetails[];

  @ApiProperty({ description: 'Connection Details for Agent' })
  @ValidateNested()
  @Type(() => ConnectionDetails)
  @IsNotEmpty()
  connectionDetails: ConnectionDetails;
}
