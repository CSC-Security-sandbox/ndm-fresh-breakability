import { IsNotEmpty, IsString, IsOptional, IsEnum, IsMongoId, ValidateNested, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Protocol, ConfigurationType, ServerType } from '../../schemas/Configuration.schema';
import { Type } from 'class-transformer';


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
    protocol: Protocol;

    @ApiProperty({ description: 'Username', example: 'admin' })
    @IsNotEmpty()
    @IsString()
    userName: string;

    @ApiProperty({ description: 'Host', example: 'localhost' })
    @IsNotEmpty()
    @IsString()
    host: string;

    @ApiProperty({ description: 'List of mounts', type: [CreateMountDto] })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => CreateMountDto)
    @IsArray()
    mounts?: CreateMountDto[] = [];

    @ApiProperty({ description: 'List of shares', type: [CreateShareDto] })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => CreateShareDto)
    @IsArray()
    shares?: CreateShareDto[] = [];
}
