import { JobStatus, JobType } from "src/constants/enums";



export interface InActivateJobConfigPayload {
    jobConfigId: string
}

export interface JobConfigBulkMigrateRes {
    status: 'created' | 'failed';
    id: string;
    jobType: JobType;
    sourcePathId: string;
    targetPathId: string;
}

export interface JobConfigBulkCutoverRes {
    status: 'created' | 'failed';
    id: string;
    jobType: JobType;
    sourcePathId: string;
    targetPathId: string;
}

export interface JobConfigPrecheckRes {
    status: string,
    workerId: string,
    workerName: string,
    sourceFileServerConnection: {
        status: string,
        message: string
    },
    targetFileServerConnection: {
        status: string,
        message: string
    },
    mountStatus: {
        status: string
    },
    permissions: {
        source: {
            path: string,
            writeAccess: boolean,
            message: string
        },
        target: {
            path: string,
            writeAccess: boolean,
            message: string
        }
    }
}