export enum WorkerStatus {
    Online = 'Online',
    Offline = 'Offline',
}

export enum Protocol{
    NFS = 'NFS',
    SMB = 'SMB'
}

export enum ProtocolVersion {
    NFSv2 = 'NFSv2',
    NFSv3 = 'NFSv3',
    NFSv4 = 'NFSv4',
    SMB2 = 'SMB2',
    SMB3 = 'SMB3',
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
    ListPaths ='ListPaths'
}