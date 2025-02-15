import { JobContext } from "@netapp-cloud-datamigrate/jobs-lib";

export interface GetJobConnectionInput{
    jobRunId: string;
}

export interface GetJobConnectionOutput{
    jobContext: JobContext
    connectionClient: any
}