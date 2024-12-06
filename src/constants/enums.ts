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

export enum QueueNames {
    TASK_LIST = 'task-list'
}
