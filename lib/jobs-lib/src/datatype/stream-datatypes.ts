import { CommandStatus, OPS_STATUS, TaskStatus, TaskType } from "src/types/enums";
import { Serializable } from "../types/serializable";


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
        checksumTime: Date | null = null
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
    checksumTime?: Date | null;
}


export class Cmd implements Serializable {
    id: string
    fPath: string;
    status: CommandStatus;
    ops: Operations
    isDir: boolean;
    metadata?: CmdMeta;

    constructor(
        id: string,
        fPath: string,
        status: CommandStatus,
        isDir: boolean,
        ops: Operations,
        metadata?: CmdMeta,
        
    ) {
        this.id = id;
        this.fPath = fPath;
        this.status = status;
        this.isDir = isDir;
        this.metadata = metadata;
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