import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { ConfigurationType, Protocol, ProtocolVersion, ServerType } from "src/constants/enums";

export class WorkingDirDTO {
    @ApiPropertyOptional({ description: 'Path Name', example: '/temp' })
    @IsString()
    @IsOptional()
    pathName: string;

    @ApiPropertyOptional({ description: 'Working Directory', example: '/working-directory' })
    @IsString()
    @IsOptional()
    workingDirectory: string;

    @ApiPropertyOptional({ description: 'Path Id', example: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' })
    @IsString()
    @IsOptional()
    pathId: string;
}

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

    @ApiProperty({ description: 'Protocol version', enum: ProtocolVersion, example: ProtocolVersion.NFSv4_0 })
    @IsOptional()
    @IsEnum(ProtocolVersion)
    protocolVersion: ProtocolVersion;

    @ApiProperty({ description: 'Username', example: 'admin' })
    @IsNotEmpty()
    userName: string;

    @ApiProperty({ description: 'Host', example: '127.0.0.1:2049' })
    @IsString()
    @IsNotEmpty()
    host: string;

    @ApiPropertyOptional({ description: 'password', example: '***' })
    @IsString()
    @IsOptional()
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

    @ApiProperty({ description: 'Working Directory', example: { pathName: '/temp', workingDirectory: '/working-directory', pathId: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' } })
    @IsObject()
    workingDirectory: WorkingDirDTO;

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

export class UpdateWorkingDirDTO extends WorkingDirDTO {
    @ApiPropertyOptional({ description: 'UUID of Working Directory', example: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' })
    @IsString()
    @IsUUID()
    @IsOptional()
    id?: string;
}

export class UpdateConfigDTO extends ConfigDTO {
    @ApiProperty({ description: 'Working Directory', example: { id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f', pathName: '/temp', workingDirectory: '/working-directory', pathId: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' } })
    @IsObject()
    workingDirectory: UpdateWorkingDirDTO;
}