export enum WorkerStatus {
    Online = 'Online',
    Offline = 'Offline',
}

export enum ConfigStatus {
    ACTIVE = 'ACTIVE',
    DRAFT = 'DRAFT',
    ERRORED = 'ERRORED',
    IN_PROGRESS = 'IN_PROGRESS'
}

export enum ConfigErrorMsg {
    ACTIVE = '',
    ERRORED = 'worker is down'
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

export enum WorkFlowType {
    PARENT_WORKFLOW='parent-workflow-tasks',
    WORKER_SPECIFIC_WORKFLOW='worker-specific-tasks',
    JOB_SPECIFIC_WORKFLOW='job-specific-tasks'
}

export enum WorkFlows{
    VALIDATE_CONNECTION = 'ValidateConnectionsWorkflow',
    LIST_PATHS = 'ListPathsWorkflow',
    VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY = 'ValidateWorkingDirectoryWorkflow'
}

export enum ProtocolVersionError{
    PROTOCOL_VERSION_ERROR = 'The server does not support to provided protocol version. Please use a valid protocol version.'
}