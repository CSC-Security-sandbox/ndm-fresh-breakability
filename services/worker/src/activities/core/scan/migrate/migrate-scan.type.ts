import { Cmd, Command, ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { Origin } from "src/activities/utils/utils.types";

export interface PublishCommandInput{
    jobContext: JobManagerContext;
    commands: Cmd[]
}

export interface DirContentsInput {
    jobContext: JobManagerContext;
    path: string;
    origin: Origin;
    errorType?: ErrorType;
    command?: Cmd;
}