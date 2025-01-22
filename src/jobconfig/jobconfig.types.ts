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