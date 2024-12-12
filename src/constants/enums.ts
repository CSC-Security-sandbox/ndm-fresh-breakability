import { ApiProperty } from "@nestjs/swagger";

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
    ListPaths = 'ListPaths',
    CreateTaskList = 'createTaskList'
}

export enum QueueNames {
    TASK_LIST = 'task-list'
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

export enum JobScheduleType {
    Now = 'NOW',
    Date = 'DATE',
    CronExp = 'CRON_EXP',
}

export enum IncrementalJobScheduleType {
    Off = 'OFF',
    Date = 'DATE',
    CronExp = 'CRON_EXP',
}

export class JobSchedule {
    @ApiProperty({ description: 'Job schedule type', enum: JobScheduleType })
    type: JobScheduleType;

    @ApiProperty({ description: 'Job schedule expression' })
    schedule: string;
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

export enum OperationType {
    ValidateNFSConnection = 'VAL_NFS_CONN',
    ValidateSMBCOnnection = 'VAL_SMB_CONN',
    ListNFSPaths = 'LS_NFS_PATHS',
    ListSMBPaths = 'LS_SMB_PATHS',
    ScanPaths = 'SCAN_PATH',
    Copy = "CP",
    CalculateChecksum = "CS",
    ComapreChecksum = "CC",
    CopyMetadata = "CM",
    ReadThroughput = "R_TPT",
    WriteThroughput = "W_TPT",
    NetworkLatency = "N_LAT",
}

export enum OperationStatus {
    Completed = 'COMPLETED',
    Failed = 'FAILED',
}

export class ErrorDetails {
    @ApiProperty({ description: 'Error code' })
    errorCode: string;

    @ApiProperty({ description: 'Error message' })
    errorMessage: string;
}


export enum TaskType {
    Scan = 'SCAN',
    Migrate = 'MIGRATE',
    Sync = 'SYNC',
    ValidateConnection = 'VALIDATE_CONNECTION',
    ListPaths = 'LIST_PATHS',
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
    InProgress = 'IN_PROGRESS',
}

export enum TaskOperation {
    ScanPath = 'SCAN_PATH',
    CopyFile = 'COPY_FILE',
    MetaStamp = 'META_STAMP'
}