import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, ValidateIf, ValidateNested } from "class-validator";
import { ConfigurationType, ExportPathSource, Protocol, ProtocolVersion, ServerType } from "src/constants/enums";

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


    @Transform(({ obj, value }) => obj.protocol === Protocol.NFS ? value : null)
    @ValidateIf(o => o.protocol === Protocol.NFS)
    @IsEnum(ExportPathSource)
    @IsOptional()
    @ApiProperty({ description: 'Export Path Source', enum: ExportPathSource, example: ExportPathSource.AUTO_DISCOVER })
    exportPathSource?: ExportPathSource;
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

// ==================== TLS Certificate DTOs ==================== //

export class FetchCertificateRequestDTO {
    @ApiProperty({ 
        description: 'Host address with optional port', 
        example: '10.192.7.32' 
    })
    @IsString()
    @IsNotEmpty()
    host: string;
}

export class CertificateSubjectDTO {
    @ApiPropertyOptional({ description: 'Common Name', example: 'isilon.example.com' })
    @IsString()
    @IsOptional()
    CN?: string;

    @ApiPropertyOptional({ description: 'Organization', example: 'Example Corp' })
    @IsString()
    @IsOptional()
    O?: string;

    @ApiPropertyOptional({ description: 'Organizational Unit', example: 'IT Department' })
    @IsString()
    @IsOptional()
    OU?: string;

    @ApiPropertyOptional({ description: 'Country', example: 'US' })
    @IsString()
    @IsOptional()
    C?: string;

    @ApiPropertyOptional({ description: 'State', example: 'California' })
    @IsString()
    @IsOptional()
    ST?: string;

    @ApiPropertyOptional({ description: 'Locality', example: 'San Jose' })
    @IsString()
    @IsOptional()
    L?: string;
}

export class FetchCertificateResponseDTO {
    @ApiProperty({ description: 'Whether the certificate is self-signed', example: true })
    @IsBoolean()
    isSelfSigned: boolean;

    @ApiProperty({ description: 'Certificate subject information', type: CertificateSubjectDTO })
    @IsObject()
    subject: CertificateSubjectDTO;

    @ApiProperty({ description: 'Certificate issuer information', type: CertificateSubjectDTO })
    @IsObject()
    issuer: CertificateSubjectDTO;

    @ApiProperty({ description: 'Certificate validity start date', example: '2024-01-01T00:00:00.000Z' })
    @IsString()
    validFrom: string;

    @ApiProperty({ description: 'Certificate validity end date', example: '2025-01-01T00:00:00.000Z' })
    @IsString()
    validTo: string;

    @ApiProperty({ description: 'Certificate serial number', example: '01:23:45:67:89:AB:CD:EF' })
    @IsString()
    serialNumber: string;

    @ApiProperty({ description: 'SHA-1 fingerprint', example: 'A1:B2:C3:D4:E5:F6:...' })
    @IsString()
    fingerprint: string;

    @ApiProperty({ description: 'SHA-256 fingerprint', example: '12:34:56:78:9A:BC:...' })
    @IsString()
    fingerprint256: string;

    @ApiProperty({ description: 'Subject Alternative Names', type: [String], example: ['DNS:isilon.example.com', 'IP:10.192.7.32'] })
    @IsArray()
    subjectAltNames: string[];

    @ApiProperty({ description: 'Days remaining until expiration', example: 365 })
    @IsNumber()
    daysRemaining: number;

    @ApiProperty({ description: 'Whether the certificate is expired', example: false })
    @IsBoolean()
    isExpired: boolean;

    @ApiProperty({ description: 'Certificate chain issuers', type: [CertificateSubjectDTO] })
    @IsArray()
    issuerChain: CertificateSubjectDTO[];

    @ApiPropertyOptional({ description: 'Certificate in PEM format' })
    @IsString()
    @IsOptional()
    certificatePEM?: string;

    @ApiProperty({ description: 'Host that was queried', example: '10.192.7.32' })
    @IsString()
    host: string;

    @ApiProperty({ description: 'Port that was queried', example: 443 })
    @IsNumber()
    port: number;
}
