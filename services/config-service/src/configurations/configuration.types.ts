import { ExportPathSource, Protocol } from "src/constants/enums";
import { WorkflowExecutionStatus } from "src/workflow/workflow.types";

export interface DiscoveredVolumeData {
    volumePath: string;
    directoryPath: string;
}

export interface ListPathWorkflowStatus {
    status: WorkflowExecutionStatus;
    id: string;
    pending: any[];
    completed: ListPathTask[];
}

interface ListPathTask {
    traceId: string;
    status: "success";
    protocolType: Protocol;
    hostname: string;
    workerId: string;
    paths: string[];
    message: string;
}

export type UserDetails = {
    trackId?: string;
    user: {
        id: string;
        roles: Role[];
    };
};

type Role = {
    role_name: string;
    projects: string[];
    permissions: string[];
};

export interface PathsMap {
    NFS: { workers: number, paths: string[] },
    SMB: { workers: number, paths: string[] }
}

export interface Credentials {
    protocol: Protocol;
    details: {
        username: string;
        hostname: string;
        password?: string
    }
    workers: string[],
    exportPathSource?: ExportPathSource;
}