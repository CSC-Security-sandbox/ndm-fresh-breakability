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

export enum JobConfigBulkMigrateResStatus {
    CREATED =  'CREATED',
    FAILED = 'FAILED'
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

export enum TemplateType {
    GID = 'gid',
    UID = 'uid',
    SID = 'sid',
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
    Errored = 'ERRORED',
    Blocked = 'BLOCKED'
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
    DISCOVERY = 'DiscoveryWorkflow',
    PRECHECK='PreCheckValidationWorkflow',
    MIGRATE = 'MigrationWorkflow'
}

export enum ConsumerType{
    files='files',
    directories='directories',
    tasks='tasks',
    updatedTask = "updatedTask",
    errors = 'errors',
    migrationTask='migrationTask'
}

export enum CutoverErrors {
    VALID_JOB_RUN_NOT_FOUND = 'VALID_JOB_RUN_NOT_FOUND'
}