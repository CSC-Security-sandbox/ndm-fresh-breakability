import { Cmd, Command, ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";

export interface DirContentsInput {
    jobContext: JobManagerContext;
    path: string;
    errorType?: ErrorType;
    command?: Cmd;
}