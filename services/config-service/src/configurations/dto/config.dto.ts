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
    serverType: ServerType;

    @ApiProperty({ description: 'Protocol', enum: Protocol, example: Protocol.NFS })
    @IsNotEmpty()
    @IsEnum(Protocol)
    protocol: Protocol;

    @ApiProperty({ description: 'Protocol version', enum: ProtocolVersion, example: ProtocolVersion.NFSv4_0 })
    @IsOptional()
    @IsEnum(ProtocolVersion)
    protocolVersion: ProtocolVersion;

    @ApiProperty({ description: 'File Server name', example: 'test' })
    @IsNotEmpty()
    fileServerName: string;

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

    @ApiPropertyOptional({ description: 'zone_id', example: 1 })
    @IsNumber()
    @IsOptional()
    zone_id?: number;

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

    @ApiProperty({ description: 'Server type', enum: ServerType, default: ServerType.other, example: ServerType.other })
    @IsEnum(ServerType)
    serverType: ServerType;

    @ApiProperty({ description: 'Management server host', example: '127.0.0.1' })
    @IsString()
    @IsOptional()
    managementHost?: string;

    @ApiProperty({ description: 'Management server port', example: 8080 })
    @IsNumber()
    @IsOptional()
    managementPort?: number;

    @ApiProperty({ description: 'Management server username', example: 'admin' })
    @IsString()
    @IsOptional()
    managementUsername?: string;

    @ApiPropertyOptional({ description: 'Management server password', example: '***' })
    @IsString()
    @IsOptional()
    managementPassword?: string;

    @ApiPropertyOptional({ description: 'TLS Accepted', example: true })
    @IsBoolean()
    @IsOptional()
    tlsAccepted?: boolean;

    @ApiPropertyOptional({ description: 'TLS Certificate', example: '-----BEGIN CERTIFICATE-----...' })
    @IsString()
    @IsOptional()
    tlsCertificate?: string;

    @ApiPropertyOptional({ description: 'TLS Expiry Date', example: '2025-12-31' })
    @IsOptional()
    tlsExpiry?: Date;
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

// ==========================================
// Storage Client DTOs
// ==========================================

/**
 * Request DTO for fetching zones from Dell Isilon
 */
export class FetchZonesRequestDTO {
    @ApiProperty({ description: 'Server type', enum: ServerType, example: ServerType.dell })
    @IsEnum(ServerType)
    @IsNotEmpty()
    serverType: ServerType;

    @ApiProperty({ description: 'Host address (IP or domain)', example: '10.192.7.32' })
    @IsString()
    @IsNotEmpty()
    host: string;

    @ApiProperty({ description: 'Port number', example: 8080, default: 8080 })
    @IsNumber()
    @IsOptional()
    port?: number;

    @ApiProperty({ description: 'Username for authentication', example: 'root' })
    @IsString()
    @IsNotEmpty()
    username: string;

    @ApiProperty({ description: 'Password for authentication', example: 'password123' })
    @IsString()
    @IsNotEmpty()
    password: string;

    @ApiProperty({ description: 'TLS certificate in PEM format' })
    @IsString()
    @IsNotEmpty()
    certificate: string;
}

/**
 * Zone information from Isilon
 */
/**
 * Zone with IP Addresses DTO - represents a zone with its IP addresses
 */
export class IsilonZoneDTO {
    @ApiProperty({ description: 'Numeric zone ID', example: 1 })
    @IsNumber()
    zoneId: number;

    @ApiProperty({ description: 'Zone name', example: 'System' })
    @IsString()
    zoneName: string;

    @ApiProperty({ description: 'Array of IP addresses for this zone', type: [String], example: ['10.192.7.105', '10.192.7.106', '10.192.7.107'] })
    @IsArray()
    @IsString({ each: true })
    ipAddresses: string[];
}

/**
 * Response DTO for fetching zones
 */
export class FetchZonesResponseDTO {
    @ApiProperty({ description: 'List of zones with IP addresses', type: [IsilonZoneDTO] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => IsilonZoneDTO)
    zones: IsilonZoneDTO[];

    @ApiProperty({ description: 'Total number of zones found', example: 3 })
    @IsNumber()
    totalZones: number;

    @ApiProperty({ description: 'Total number of IP addresses across all zones', example: 15 })
    @IsNumber()
    totalIpAddresses: number;
}

/**
 * NFS Export Path DTO
 */
export class NFSExportPathDTO {
    @ApiProperty({ description: 'Export path', example: '/ifs/data' })
    @IsString()
    path: string;

    @ApiProperty({ description: 'Export ID', example: 1 })
    @IsNumber()
    @IsOptional()
    id?: number;
}

/**
 * SMB Share DTO
 */
export class SMBShareDTO {
    @ApiProperty({ description: 'Share name', example: 'data' })
    @IsString()
    name: string;

    @ApiProperty({ description: 'Share path', example: '/ifs/data' })
    @IsString()
    @IsOptional()
    path?: string;
}
export class GetNFSExportPathsRequestDTO {
    @ApiProperty({ description: 'File Server ID (zone)', example: 'uuid' })
    @IsUUID()
    fileServerId: string;
}

// Response DTO
export class GetNFSExportPathsResponseDTO {
    @ApiProperty({ description: 'List of NFS export paths', type: [NFSExportPathDTO] })
    @IsArray()
    exports: NFSExportPathDTO[];

    @ApiProperty({ description: 'Total number of exports found', example: 5 })
    @IsNumber()
    totalExports: number;
}

export class GetSMBExportPathsRequestDTO {
    @ApiProperty({ description: 'File Server ID (zone)', example: 'uuid' })
    @IsUUID()
    fileServerId: string;
}

// Response DTO
export class GetSMBExportPathsResponseDTO {
    @ApiProperty({ description: 'List of SMB export paths', type: [SMBShareDTO] })
    @IsArray()
    exports: SMBShareDTO[];

    @ApiProperty({ description: 'Total number of exports found', example: 5 })
    @IsNumber()
    totalExports: number;
}
