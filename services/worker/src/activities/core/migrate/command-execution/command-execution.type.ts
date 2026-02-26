import { Command, CommandOperation, ErrorType, JobManagerContext, MetaData, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { Cmd, ItemInfo } from "@netapp-cloud-datamigrate/jobs-lib/dist/datatype/stream-datatypes";

/** COC report status: success, failed, or not_applicable when operation was not triggered */
export type CocOperationStatus = 'success' | 'failed' | 'not_applicable';

export interface CommandExecInput {
    sourcePath: string;
    targetPath: string;
    jobContext: JobManagerContext;
    command: Cmd;
    errorType?: ErrorType | undefined;
    /** COC report: copy content status (set by executeCommand before publishFileInfo) */
    copyContentStatus?: CocOperationStatus;
    /** COC report: stamp metadata status (set by executeCommand before publishFileInfo) */
    stampMetaDataStatus?: CocOperationStatus;
}

export interface CommandExecOutput {
    sourceErrors: string[];
    targetErrors: string[];
    cmd: Cmd;
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
