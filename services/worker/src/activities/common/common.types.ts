import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";


export interface BuildOrGetScanTaskInput {
    dirToScans: string[];
    taskHashId: string;
    jobContext: JobManagerContext;
    jobRunId: string;
}