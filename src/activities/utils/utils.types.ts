import { JobContext } from "@netapp-cloud-datamigrate/jobs-lib";
import fs from 'fs';

export interface GetJobConnectionInput{
    jobRunId: string;
}

export interface GetJobConnectionOutput{
    jobContext: JobContext
    connectionClient: any
}

export interface ExcludeOrSkipParams {
    fullPath: string;
    stats: fs.Stats;
    excludePatterns: string[];
    skipTime: string;
    olderThan: Date;
    jobType: string;
}
