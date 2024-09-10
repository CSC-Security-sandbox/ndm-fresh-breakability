import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { CreateConfigurationDto } from './createconfiguration.dto';
import { ConfigurationType, Protocol, ServerType, Volume } from '../../schemas/Configuration.schema';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateConfigurationDto extends PartialType(CreateConfigurationDto) {
    @ApiProperty({ description: 'Name', example: "Agent 1" })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiProperty({ description: 'Server type', enum: ServerType, example: ServerType.other })
    @IsEnum(ServerType)
    serverType?: ServerType = ServerType.other;

    @ApiProperty({ description: 'Protocol', example: Protocol.NFS })
    @IsOptional()
    @IsEnum(Protocol)
    protocol?: Protocol;

    @ApiProperty({ description: 'Configuration type', example: ConfigurationType.file })
    @IsEnum(ConfigurationType)
    @IsOptional()
    configurationType?: ConfigurationType;

    @ApiProperty({ description: 'User name', example: 'admin', required: false })
    @IsOptional()
    @IsString()
    userName?: string;

    @ApiProperty({ description: 'Host', example: 'localhost', required: false })
    @IsOptional()
    @IsString()
    host?: string;
      
    @ApiProperty({ description: 'Array of volumes with mountPath and sharePath', type: [Volume], default: [] })
    volumes: Volume[];
}