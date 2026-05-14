export interface ThreadTask {
    data: any;
    Operation: ThreadOperation;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    id: string;
    enqueuedAt: number;
}

export interface WorkerDetails{
    operationBand: string;
    operatingTasks:  string[];
}

export interface OperationBand{
    numberOfThreads: number;
    task: ThreadTask[];
}

export interface ThreadTaskInput {
    data: any;
    Operation: ThreadOperation;
    id: string;
}

export interface WorkerThreadOutput {
    data: any;
    id: string;
    Operation: ThreadOperation;
    isResolved? : boolean;
    isRejected ?: boolean;
}

export interface WorkerThreadInput {
    data: any;
    id: string;
    Operation: ThreadOperation;
}

export enum ThreadOperation {
    COPY_FILE = 'COPY_FILE',
    EXIT = 'EXIT'
}

export interface MigrateFile {
    sourcePath: string;
    destinationPath: string;
    operationId: string;
    size: number;
    jobRunId?: string;
    /** When true, prefer read paths that avoid advancing source atime (Linux O_NOATIME; Windows falls back to stamp). */
    preserveAccessTime?: boolean;
    /** Task source path id — atime diagnostics keyed per source (not per file). */
    sPathId?: string;
}