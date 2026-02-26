import { Command, CommandOperation, ErrorType, JobManagerContext, MetaData, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { Cmd, ItemInfo } from "@netapp-cloud-datamigrate/jobs-lib/dist/datatype/stream-datatypes";


export interface CommandExecInput {
    sourcePath: string;
    targetPath: string;
    jobContext: JobManagerContext;
    command: Cmd;
    errorType?: ErrorType | undefined
}

export interface CommandExecOutput {
    sourceErrors: string[];
    targetErrors: string[];
    cmd: Cmd;
}

export interface ExecuteCommandOptions {
    /** When true on Windows, skip ACL stamp (caller will run stampAclBatch); only times are stamped. */
    skipAclStamp?: boolean;
}

export interface CommandOutput {
    shouldStampMeta: boolean;
    sourceErrors: string[];
    targetErrors: string[];
    shouldUpdateItemInfo: boolean;
}


export interface ValidateCommandInput {
    cmd: Cmd;
    jobContext: JobManagerContext;
    item: ItemInfo;
    errorType?: ErrorType | undefined
    targetPath?: string;
}
