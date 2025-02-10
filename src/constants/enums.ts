// -------------- worker ------------- //
export enum WorkerStatus {
    Online = 'Online',
    Offline = 'Offline',
}


// -------------- Protocol ------------- //
export enum Protocol {
    NFS = 'NFS',
    SMB = 'SMB'
}

// -------------- Config ------------- //
export enum ServerType {
    other = 'OtherNAS',
    dell = 'dell',
    emc = 'emc'
}

export enum ConfigurationType {
    file = 'FILE',
    objectStorage = 'OBJECT_STORAGE'
}


// ---------- Job -----------/

export enum JobStatus {
    Active = 'ACTIVE',
    InActive = 'IN_ACTIVE',
}
  
export enum JobType {
    DISCOVER = 'DISCOVER',
    MIGRATE = 'MIGRATE',
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



// -------------- QueueEvent ------------- //
export enum RabbitMq {
    ListPaths ='ListPaths',
    CreateTaskList = 'taskList'
}

export enum WorkFlowType {
    PARENT_WORKFLOW='parent-workflow-tasks',
    WORKER_SPECIFIC_WORKFLOW='worker-specific-tasks',
}

export enum WorkFlows{
    DISCOVERY = 'DiscoveryWorkflow'
}

