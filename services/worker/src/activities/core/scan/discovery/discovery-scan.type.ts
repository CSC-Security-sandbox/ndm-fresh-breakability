import { Cmd, Command, ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import * as fs from 'fs';
export interface DirContentsInput {
    jobContext: JobManagerContext;
    path: string;
    errorType?: ErrorType;
    command?: Cmd;
}


export interface PublishItemInfoInput {
    stats: fs.Stats;
    fPath: string
    jobContext: JobManagerContext;
    command: Cmd;
    relativeSourcePath: string;
}