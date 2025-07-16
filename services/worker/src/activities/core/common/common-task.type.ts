import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";


export interface BuildOrGetScanTaskInput {
    taskHashId: string;
    jobContext: JobManagerContext;
    jobRunId: string;
    batchId?: string;
}

export interface CreateInitBatchInput {
    jobRunId: string;
    dirsToScan: string[];
}