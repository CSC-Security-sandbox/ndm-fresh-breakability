export interface Result {
    unscanned: string[],
    path: string
}

export interface FileStats {
    fullPath: string
}

export interface ProcessFolderReadParams {
    files: string[];
    chunkPath: string;
    jobRunId: string;
    pathId: string;
    batchSize: number;
    workerId: string;
    commandId: string;
    excludePattern: string[];
    taskId;
}

export interface FileEntry {
    taskId: string;
    pathId: string;
    fileName: string;
    path: string;
    parentPath: string;
    jobRunId: string;
    isDirectory: boolean;
    uid: string;
    gid: string;
    fileSize: number;
    blocks: number;
    modifiedTime: string;
    birthTime: string;
    extension: string;
    permission: string;
    accessTime: string;
    fileType: string;
    depth: number;
}

export enum FileType {
    FILE = "FILE",
    DIRECTORY = "DIRECTORY",
    SYMBOLIC_LINK = "SYMBOLIC_LINK",
    SOCKET = "SOCKET",
    FIFO = "FIFO",
    CHARACTER_DEVICE = "CHARACTER_DEVICE",
    BLOCK_DEVICE = "BLOCK_DEVICE",
    UNKNOWN = "UNKNOWN"
}