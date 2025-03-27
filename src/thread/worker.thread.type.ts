export interface ThreadTask {
    data: any;
    Operation: ThreadOperation;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    id: string;
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
    isResolved : boolean;
    isRejected : boolean;
}

export enum ThreadOperation {
    COPY_FILE = 'COPY_FILE',
    EXIT = 'EXIT'
}

export interface MigrateFile{
    sourcePath: string;
    destinationPath: string;
    operationId: string;
}