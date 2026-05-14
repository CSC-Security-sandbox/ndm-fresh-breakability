import { Command, CommandOperation, ErrorType, JobManagerContext, MetaData, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { Cmd, ItemInfo } from "@netapp-cloud-datamigrate/jobs-lib/dist/datatype/stream-datatypes";

/** COC report status: success, failed, or not_applicable when operation was not triggered */
export type CocOperationStatus = 'success' | 'failed' | 'not_applicable';

export interface CommandExecInput {
    sourcePath: string;
    targetPath: string;
    /** Task source path id — used for atime diagnostics (one log line per source per job). */
    sPathId?: string;
    jobContext: JobManagerContext;
    command: Cmd;
    errorType?: ErrorType | undefined;
    /** COC report: copy content status (set by executeCommand before publishFileInfo) */
    copyContentStatus?: CocOperationStatus;
    /** COC report: stamp metadata status (set by executeCommand before publishFileInfo) */
    stampMetaDataStatus?: CocOperationStatus;
    /**
     * Read-side atime strategy outcome from the worker thread for the file
     * that was just copied. Forwarded by `executeCommand` from
     * `CommandOutput.atimeReadStrategy` so the stamp phase can decide
     * whether Strategy 5 source `utimes` is necessary or already redundant
     * (Strategy 2 O_NOATIME or Strategy 3 mount-noatime already prevented
     * the kernel atime bump). See `atime-preserve.utils#atimeKernelGuaranteed`.
     */
    atimeReadStrategy?: string;
}

export interface CommandExecOutput {
    sourceErrors: string[];
    targetErrors: string[];
    cmd: Cmd;
    /** Collected ItemInfo for bulk publishing — populated when shouldUpdateItemInfo is true */
    itemInfo?: ItemInfo;
}

export interface CommandOutput {
    shouldStampMeta: boolean;
    sourceErrors: string[];
    targetErrors: string[];
    shouldUpdateItemInfo: boolean;
    /** Source ctime (ms since epoch, floored) captured after stamp operations complete.
     *  Used to update the deferred dir stamp record for directories
     *  so the post-migration restamp pass compares against the correct baseline. */
    postStampSourceCtimeMs?: number;
    /**
     * Read-side atime strategy outcome surfaced by `copyFile` after the
     * worker thread resolves; only set for file copies (other operations
     * leave it undefined). `executeCommand` forwards this to
     * `CommandExecInput.atimeReadStrategy` before invoking the stamp phase.
     */
    atimeReadStrategy?: string;
}


export interface ValidateCommandInput {
    cmd: Cmd;
    jobContext: JobManagerContext;
    item: ItemInfo;
    errorType?: ErrorType | undefined
    targetPath?: string;
}
