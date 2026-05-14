import { ProtocolTypes } from "../protocols";


export interface ProtocolPayload{
    hostname?: string;
    username?: string;
    protocolVersion: string;
    password?: string;
    path?: string;
    jobRunId?: string
    pathId?: string;
    mountBasePath?: string;
    /** When false, skip NFS mount noatime/nodiratime attempts for this job. */
    preserveAccessTime?: boolean;
}

export interface CommandOutput{
    traceId?: string;
    status?: string;
    protocolType?: ProtocolTypes;
    hostname?: string;
    workerId?: string;
    message?: string;
}