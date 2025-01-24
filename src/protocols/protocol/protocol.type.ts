import { ProtocolTypes } from "../protocols";


export interface ProtocolPayload{
    hostname?: string;
    username?: string;
    password?: string;
    path?: string;
    jobRunId?: string
}

export interface CommandOutput{
    traceId?: string;
    status?: string;
    protocolType?: ProtocolTypes;
    hostname?: string;
    workerId?: string;
    message?: string;
}