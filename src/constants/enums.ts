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
    CreateTaskList = 'createTaskList'
}

export enum MessagesName {
    CREATE_TASK_LIST = 'myqueue-task-list'
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



export enum OperationStatus{
    
}