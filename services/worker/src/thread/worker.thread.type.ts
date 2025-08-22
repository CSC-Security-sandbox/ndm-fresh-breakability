export interface ThreadTask {
    data: any;
    Operation: ThreadOperation;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    id: string;
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
    STAMP_METADATA = 'STAMP_METADATA',
    EXIT = 'EXIT'
}

export interface MigrateFile{
    sourcePath: string;
    destinationPath: string;
    operationId: string;
    size: number;
}

export interface StampMetadataTask {
    operationId: string;
    commandExecInput: any; // Will contain the full CommandExecInput
}