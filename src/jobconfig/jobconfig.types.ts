import { JobConfigBulkMigrateResStatus, JobStatus, JobType } from "src/constants/enums";

export interface InActivateJobConfigPayload {
    jobConfigId: string
}

export interface JobConfigBulkMigrateRes {
    id: string;
    jobType: JobType;
    status: JobConfigBulkMigrateResStatus;
    sourcePathId: string;
    targetPathId: string;
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
    status: 'success'
}