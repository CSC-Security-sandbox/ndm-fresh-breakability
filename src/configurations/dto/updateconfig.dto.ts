import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, isString, IsString, IsUUID, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ConfigurationType, Protocol, ServerType } from "src/constants/enums";

export class VolumesUpdateDTO {

    @ApiProperty({ description: 'UUID of Volume', example: "66ce0b1d79db96d54332af29" })
    @IsString()
    @IsUUID()
    @IsOptional()
    id: string;

    @ApiProperty({ description: 'Volume path', example: '/dir' })
    @IsString()
    volumePath: string;

    @ApiProperty({ description: 'Is path included', example: "true" })
    @IsBoolean()
    isIncluded: boolean;

    @ApiProperty({ description: 'UUID of createdBy', example: "66ce0b1d79db96d54332af29" })
    @IsString()
    @IsUUID()
    @IsOptional()
    createdBy: string;

}

export class FileServersUpdateDTO {
    @ApiProperty({ description: 'UUID of fileserver', example: "true" })
    @IsString()
    @IsUUID()
    @IsOptional()
    id: string;

    @ApiProperty({ description: 'Server type', enum: ServerType, default: ServerType.other, example: ServerType.other })
    @IsEnum(ServerType)
    serverType?: ServerType = ServerType.other;

    @ApiProperty({ description: 'Protocol', enum: Protocol, example: Protocol.NFS })
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

    @ApiProperty({ description: 'Array of volumes', type: [VolumesUpdateDTO]})
    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => VolumesUpdateDTO)
    volumes: VolumesUpdateDTO[];

    @ApiProperty({ description: 'Array of Agent IDs', type: [String] })
    @IsArray()
    @IsUUID('all', { each: true })
    agents: string[];

    @ApiProperty({ description: 'UUID of createdBy', example: "66ce0b1d79db96d54332af29" })
    @IsString()
    @IsUUID()
    @IsOptional()
    createdBy: string;
}

export class ConfigUpdateDTO {
    @ApiProperty({ description: 'Project Id', example: '66ce0b1d79db96d54332af29' })
    @IsNotEmpty()
    projectId: string;

    @ApiProperty({ description: 'stage', example: 'stage 1' })
    @IsString()
    @IsNotEmpty()
    stage: string;

    @ApiProperty({ description: 'Name', example: 'Config 1' })
    @IsString()
    @IsNotEmpty()
    configName: string;

    @ApiProperty({ description: 'Configuration type', enum: ConfigurationType, example: ConfigurationType.file })
    @IsEnum(ConfigurationType)
    @IsNotEmpty()
    configType: ConfigurationType;

    @ApiProperty({ description: 'Array of config details', type: [FileServersUpdateDTO] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FileServersUpdateDTO)
    fileServers: FileServersUpdateDTO[];

    @ApiProperty({ description: 'UUID of createdBy', example: "66ce0b1d79db96d54332af29" })
    @IsString()
    @IsUUID()
    @IsOptional()
    createdBy: string;
}
