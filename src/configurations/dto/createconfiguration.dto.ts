import { IsNotEmpty, IsString, IsOptional, IsEnum, IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Protocol, ConfigurationType, ServerType } from '../../schemas/Configuration.schema';

export class CreateConfigurationDto {
    @ApiProperty({ description: 'Project Id', example: '60c72b2f9b1e8b001c8b4567' })
    @IsNotEmpty()
    @IsMongoId()
    projectId: Types.ObjectId;

    @ApiProperty({ description: 'Configuration type', example: ConfigurationType.file })
    @IsNotEmpty()
    @IsEnum(ConfigurationType)
    configurationType: ConfigurationType;

    @ApiProperty({ description: 'Server type', example: ServerType.other })
    @IsOptional()
    @IsEnum(ServerType)
    serverType?: ServerType = ServerType.other;

    @ApiProperty({ description: 'Protocol', example: Protocol.NFS })
    @IsNotEmpty()
    @IsEnum(Protocol)
    protocal: Protocol;

    @ApiProperty({ description: 'Username', example: 'admin' })
    @IsNotEmpty()
    @IsString()
    userName: string;

    @ApiProperty({ description: 'Host', example: 'localhost' })
    @IsNotEmpty()
    @IsString()
    host: string;
}
