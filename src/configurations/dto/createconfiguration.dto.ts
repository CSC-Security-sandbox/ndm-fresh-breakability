import { IsNotEmpty, IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Protocol, ConfigurationType, ServerType, Volume } from '../../schemas/Configuration.schema';


export class CreateMountDto {
    @ApiProperty({ description: 'Mount path', example: '/mnt/data' })
    @IsNotEmpty()
    @IsString()
    mountPath: string;
}

export class CreateShareDto {
    @ApiProperty({ description: 'Share path', example: '/share/data' })
    @IsNotEmpty()
    @IsString()
    sharePath: string;
}

export class CreateConfigurationDto {
    @ApiProperty({ description: 'Project Id', example: '66ce0b1d79db96d54332af29' })
    @IsNotEmpty()
    projectId: Types.ObjectId;

    @ApiProperty({ description: 'Name', example: "Agent 1" })
    @IsString()
    @IsNotEmpty()
    name: string;
  
    @ApiProperty({ description: 'Configuration type', enum: ConfigurationType, example: ConfigurationType.file })
    @IsEnum(ConfigurationType)
    @IsNotEmpty()
    configurationType: ConfigurationType;
  
    @ApiProperty({ description: 'Server type', enum: ServerType, default: ServerType.other, example: ServerType.other })
    @IsEnum(ServerType)
    serverType?: ServerType = ServerType.other;

    @ApiProperty({ description: 'Protocol', example: Protocol.NFS })
    @IsNotEmpty()
    @IsEnum(Protocol)
    protocol: Protocol;

    @ApiProperty({ description: 'Username', example: 'admin' })
    @IsNotEmpty()
    userName: string;
  
    @ApiProperty({ description: 'Host', example: '127.0.0.1:2049' })
    @IsString()
    @IsNotEmpty()
    host: string;
  
    @ApiProperty({ description: 'Array of volumes with mountPath and sharePath', type: [Volume], default: [] })
    @IsArray()
    @IsOptional()
    volumes: Volume[];
}