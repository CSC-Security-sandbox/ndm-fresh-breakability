import { Command, ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";

export interface DirContentsInput {
    jobRunId: string;
    path: string;
    errorType?: ErrorType;
    command?: Command;
}