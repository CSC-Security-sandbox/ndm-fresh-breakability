export enum Pattern {
    INVENTORY = 'inventory',
    DISCOVERY_COMPLETED = 'discovery-completed'
}

export enum OperationStatus{
    READY='READY',
    IN_PROCESS='IN_PROCESS',
    ERROR ='ERROR',
    COMPLETED = 'COMPLETED'
}

export enum OperationType {
    SCAN = 'SCAN'
}

export enum TaskType {
    Scan = 'SCAN',
    Migrate = 'MIGRATE',
    Copy = 'COPY'
}


// -------------- Task ------------- //

export enum TaskStatus {
    Pending = 'PENDING',
    Running = 'RUNNING',
    Errored = 'ERRORED',
    Completed = 'COMPLETED',
}

export enum TaskOperation {
    ScanPath = 'SCAN_PATH',
    CopyFile = 'COPY_FILE',
    MetaStamp = 'META_STAMP'
}