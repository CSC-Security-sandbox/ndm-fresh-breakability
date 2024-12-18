import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { ConfigurationType, Protocol, ServerType } from "src/constants/enums";

export class FileServersDTO {
    @ApiProperty({ description: 'UUID of fileserver', example: "36bfd77f-1d7c-47a3-8c62-3c8739e2f88f" })
    @IsString()
    @IsUUID()
    @IsOptional()
    id?: string;

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

    @ApiPropertyOptional({ description: 'password', example: '***' })
    @IsString()
    @IsNotEmpty()
    password?: string;

    @ApiProperty({ description: 'Array of Worker IDs', type: [String] , example: ['4160b89b-bb37-48e0-81bb-16a027622d2e']})
    @IsArray()
    @IsUUID('all', { each: true })
    workers: string[];

    @ApiProperty({ description: 'UUID of createdBy', example: "36bfd77f-1d7c-47a3-8c62-3c8739e2f88f" })
    @IsString()
    @IsUUID()
    @IsOptional()
    createdBy?: string;
}

export class ConfigDTO {
    @ApiProperty({ description: 'Project Id', example: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' })
    @IsNotEmpty()
    projectId: string;

    @ApiProperty({ description: 'Name', example: 'Config 1' })
    @IsString()
    @IsNotEmpty()
    configName: string;

    @ApiPropertyOptional({ description: 'Working Directory', example: '/temp' })
    @IsString()
    @IsOptional()
    workingDirectory?: string;

    @ApiProperty({ description: 'Configuration type', enum: ConfigurationType, example: ConfigurationType.file })
    @IsEnum(ConfigurationType)
    @IsNotEmpty()
    configType: ConfigurationType;

    @ApiProperty({ description: 'Array of config details', type: [FileServersDTO] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FileServersDTO)
    fileServers: FileServersDTO[];


    @ApiProperty({ description: 'UUID of createdBy', example: "36bfd77f-1d7c-47a3-8c62-3c8739e2f88f" })
    @IsString()
    @IsUUID()
    @IsOptional()
    createdBy?: string;
}
