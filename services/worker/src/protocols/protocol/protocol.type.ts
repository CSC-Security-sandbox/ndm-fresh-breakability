import { ProtocolTypes } from "../protocols";

// Server types for routing to vendor-specific protocol implementations
export enum ServerType {
    OTHER_NAS = 'OtherNAS',
    DELL_ISILON = 'DellIsilon',
}

export interface ProtocolPayload{
    hostname?: string;
    username?: string;
    protocolVersion: string;
    password?: string;
    path?: string;
    jobRunId?: string
    pathId?: string;
    mountBasePath?: string;
    serverType?: ServerType;
    protocol?: string;                  // Protocol type (NFS/SMB)
    useStorageAPI?: boolean;            // Flag to enable vendor-specific API
    storageApiCredentials?: {           // Optional API credentials for storage systems
        username?: string;              // API username
        password?: string;              // API password
        apiEndpoint?: string;           // API endpoint URL
    };
}

export interface CommandOutput{
    traceId?: string;
    status?: string;
    protocolType?: ProtocolTypes;
    hostname?: string;
    workerId?: string;
    message?: string;
}