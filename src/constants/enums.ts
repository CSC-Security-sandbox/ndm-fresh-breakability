
export enum WorkerStatus {
    Online = 'Online',
    Offline = 'Offline',
}

export enum Protocol {
    NFS = 'NFS',
    SMB = 'SMB'
}

export enum ServerType {
    other = 'OtherNAS',
    dell = 'dell',
    emc = 'emc'
}

export enum ConfigurationType {
    file = 'FILE',
    objectStorage = 'OBJECT_STORAGE'
}

export enum RabbitMq {
    ListPaths ='ListPaths',
    CreateTaskList = 'task-list'
}

export enum JobStatus {
    Active = 'ACTIVE',
    InActive = 'IN_ACTIVE',
}
  
export enum JobType {
    Scan = 'SCAN',
    Migrate = 'MIGRATE',
    CutOver = 'CUT_OVER',
}

export enum JobIdMappingType {
    Gid = 'GID',
    Uid = 'UID',
    Sid = 'SID'
}

// ---------- Job Run -----------/
export enum JobRunStatus {
    Ready = 'READY',
    Pending = 'PENDING',
    Running = 'RUNNING',
    Paused = 'PAUSED',
    Stopped = 'STOPPED',
    Completed = 'COMPLETED',
    Failed = 'FAILED',
    Errored = 'ERRORED'
}


// ---------- Job Run -----------/
export enum TaskType {
    Scan = 'SCAN',
    Migrate = 'MIGRATE',
    Copy = 'COPY'
}

export enum TaskStatus {
    Ready = 'READY',
    Pending = 'PENDING',
    Running = 'RUNNING',
    Paused = 'PAUSED',
    Stopped = 'STOPPED',
    Errored = 'ERRORED',
    Failed = 'FAILED',
    Completed = 'COMPLETED',
}

export enum TaskOperation {
    ScanPath = 'SCAN_PATH',
    CopyFile = 'COPY_FILE',
    MetaStamp = 'META_STAMP'
}


// ---------- Operations -----------/
export enum OperationStatus{
    READY='READY',
    IN_PROCESS='IN_PROCESS',
    ERROR ='ERROR',
    COMPLETED = 'COMPLETED'
}

export enum OperationType {
    SCAN = 'SCAN'
}
