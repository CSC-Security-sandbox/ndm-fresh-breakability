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
    adServerIp?: string;
}

export interface CommandOutput{
    traceId?: string;
    status?: string;
    protocolType?: ProtocolTypes;
    hostname?: string;
    workerId?: string;
    message?: string;
}