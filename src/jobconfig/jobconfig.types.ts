import { JobStatus, JobType } from "src/constants/enums";



export interface InActivateJobConfigPayload {
    jobConfigId: string
}

export interface JobConfigBulkMigrateRes {
    id: string;
    jobType: JobType;
    status: JobStatus;
    excludeOlderThan?: Date;
    excludeFilePatterns?: string;
    preserveAccessTime: boolean;
    firstRunAt: Date;
    futureScheduleAt: string;
    sourcePathId: string;
    targetPathId: string[];
    scheduler: string;
}

export interface JobConfigBulkCutoverRes {
    id: string;
    jobType: JobType;
    status: JobStatus;
    firstRunAt: Date;
    sourcePathId: string;
    targetPathId: string[];
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