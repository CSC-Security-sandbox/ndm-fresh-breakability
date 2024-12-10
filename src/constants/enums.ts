export enum WorkerStatus {
    Online = 'Online',
    Offline = 'Offline',
}

export enum Protocol{
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
