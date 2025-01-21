export enum WorkerStatus {
    Online = 'Online',
    Offline = 'Offline',
}

export enum ConfigStatus {
    ACTIVE = 'ACTIVE',
    DRAFT = 'DRAFT',
}

export enum Protocol{
    NFS = 'NFS',
    SMB = 'SMB'
}

export enum ProtocolVersion {
    NFSv3 = 'v3',
    NFSv4_0 = 'v4.0',
    NFSv4_1 = 'v4.1',
    NFSv4_2 = 'v4.2',
    SMBv2_0 = 'v2.0',
    SMBv3_0 = 'v3.0',
    SMBv3_1_1 = 'v3.1.1',
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