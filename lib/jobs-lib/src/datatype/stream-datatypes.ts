import { CommandStatus, OPS_STATUS, TaskStatus, TaskType } from "src/types/enums";
import { Serializable } from "../types/serializable";


/** Status for copy-content and stamp-metadata columns in COC report: success, failed, or not_applicable when operation was not triggered */
export type OperationStatusValue = 'success' | 'failed' | 'not_applicable';

export class ItemInfo implements Serializable {
    fileName: string;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    depth: number;
    extension: string;
    fileType: string;
    sourceMeta: ItemMeta;
    targetMeta: ItemMeta;
    size: number;
    inode: number;
    isDeleted: boolean;
    checksumTime: Date | null;
    /** COC report: status of file content copy (success / failed / not_applicable) */
    copyContentStatus?: OperationStatusValue;
    /** COC report: status of metadata stamping (success / failed / not_applicable) */
    stampMetaDataStatus?: OperationStatusValue;

    constructor(
        fileName: string,
        isDirectory: boolean,
        isSymbolicLink: boolean,
        depth: number,
        extension: string,
        fileType: string,
        sourceMeta: ItemMeta,
        targetMeta: ItemMeta,
        size: number,
        inode: number,
        isDeleted: boolean = false,
        checksumTime: Date | null = null,
        copyContentStatus?: OperationStatusValue,
        stampMetaDataStatus?: OperationStatusValue
    ) {
        this.fileName = fileName;
        this.isDirectory = isDirectory;
        this.isSymbolicLink = isSymbolicLink;
        this.depth = depth;
        this.extension = extension;
        this.fileType = fileType;
        this.sourceMeta = sourceMeta;
        this.targetMeta = targetMeta;
        this.size = size;
        this.inode = inode;
        this.isDeleted = isDeleted;
        this.checksumTime = checksumTime;
        this.copyContentStatus = copyContentStatus;
        this.stampMetaDataStatus = stampMetaDataStatus;
    }

    serialize(): string {
        return JSON.stringify(this);
    }

    static deserialize(serialized: string): ItemInfo {
        return JSON.parse(serialized);
    }   
}

export interface ItemMeta{
    birthTime: Date;
    modifiedTime: Date;
    accessTime: Date;
    permission: string;
    sid?: string;
    uid?: number;
    gid?: number;
    checksum?: string;
}


export class Cmd implements Serializable {
    id: string
    fPath: string;
    status: CommandStatus;
    ops: Operations
    isDir: boolean;
    metadata?: CmdMeta;
    originalCmdId?: string; // Original command ID for retry tracking - if set, this is a retry command

    constructor(
        id: string,
        fPath: string,
        status: CommandStatus,
        isDir: boolean,
        ops: Operations,
        metadata?: CmdMeta,
        originalCmdId?: string,
    ) {
        this.id = id;
        this.fPath = fPath;
        this.status = status;
        this.isDir = isDir;
        this.metadata = metadata;
        this.originalCmdId = originalCmdId;
        if(ops)
            this.ops = ops;
    }

    serialize(): string {
        return JSON.stringify(this);
    }

    static deserialize(serialized: string): Cmd {
        return JSON.parse(serialized);
    }
}

export interface CmdMeta {
    size: number;
    mtime: Date;
    atime: Date;
    ctime: Date;
    birthtime: Date;
    mode: number;
    uid: number;
    gid: number;
    sid: string;
    inode: number;
    isSymLink?: boolean;
}

export interface Operations {
    [key: string]: Ops;
}

export interface Ops {
    status: OPS_STATUS;
    params: {
        [key: string]: any;
    }
}

export class TaskInfo implements Serializable{
    id: string;
    jobRunId: string;
    taskType: TaskType;
    status: TaskStatus;
    workerId: string;
    sPathId: string;
    tPathId?: string | null;
    excludeFilePatterns?: string;
    retryCount: number;
    commands: Cmd[];

    constructor(
        id: string,
        jobRunId: string,
        taskType: TaskType,
        status: TaskStatus,
        workerId: string,
        sPathId: string,
        commands: Cmd[],
        tPathId?: string | null,
        excludeFilePatterns?: string,
        retryCount: number = 0
    ) {
        this.id = id;
        this.jobRunId = jobRunId;
        this.taskType = taskType;
        this.status = status;
        this.workerId = workerId;
        this.sPathId = sPathId;
        this.tPathId = tPathId;
        this.excludeFilePatterns = excludeFilePatterns;
        this.commands = commands;
        this.retryCount = retryCount;
    }
    serialize(): string {
        return JSON.stringify(this);
    }
    static deserialize(serialized: string): TaskInfo {
        return JSON.parse(serialized);
    }
}

export class FailedOperations implements Serializable{
    id: string;
    fPath: string;
    constructor(id: string, fPath: string) {
        this.id = id;
        this.fPath = fPath;
    }
    serialize(): string {
        return JSON.stringify(this);
    }
    static deserialize(serialized: string): FailedOperations {
        return JSON.parse(serialized);
    }
}

export class RetryBatchInfo implements Serializable{
    parentPath: string;
    operations: FailedOperations[];

    constructor(parentPath: string, operations: FailedOperations[]) {
        this.parentPath = parentPath;
        this.operations = operations;
    }

    serialize(): string {
        return JSON.stringify(this);
    }

    static deserialize(serialized: string): RetryBatchInfo {
        const data = JSON.parse(serialized);
        return new RetryBatchInfo(data.parentPath, data.operations);
    }
}

