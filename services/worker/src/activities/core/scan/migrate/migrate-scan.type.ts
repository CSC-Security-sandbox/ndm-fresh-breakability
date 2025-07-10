import { Command, ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { Origin } from "src/activities/utils/utils.types";

export interface PublishCommandInput{
    jobRunId: string;
    commands: Command[]
}

export interface DirContentsInput {
    jobRunId: string;
    path: string;
    origin: Origin;
    errorType?: ErrorType;
    command?: Command;
}