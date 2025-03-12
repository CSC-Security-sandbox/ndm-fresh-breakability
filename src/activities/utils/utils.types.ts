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
export enum Origin {
    SOURCE = 'Source',
    DESTINATION = 'Destination'
}


export enum Operation {
    COPY_CONTENT='Copy Content',
    READ_DIR = 'Read Directory',
    READ_FILE = 'Read File',
    STAMP_META = 'Update Metadata',
    STAMP_TIME = 'Update a-time',
}