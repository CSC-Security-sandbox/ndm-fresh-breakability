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
    ListPaths = 'ListPaths'
}

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

export enum JobStatus {
    Active = 'ACTIVE',
    InActive = 'IN_ACTIVE',
}

export enum JobType {
    Discover = 'DISCOVER',
    Migrate = 'MIGRATE',
    CutOver = 'CUT_OVER',
    SpeedTest = 'SPEED_TEST',
}

// -------------- Task ------------- //

export enum TaskStatus {
    Pending = 'PENDING',
    Running = 'RUNNING',
    Errored = 'ERRORED',
    Completed = 'COMPLETED',
}

export enum TaskOperation {
    SCAN_PATH = 'SCAN_PATH',
    COPY_FILE = 'COPY_FILE',
    META_STAMP = 'META_STAMP'
}

export enum TaskType {
    SCAN = 'SCAN',
    COPY = 'COPY'
}

export enum ReportType {
    JOB_RUN_STATS = 'JobRunStats'
}

