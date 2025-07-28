export class WorkerConfiguration {
    workerId: string;
    configName: string;
    taskQueueId: string;
    dynamicTaskQueue: boolean;    
}

export enum WorkerState  {
    INITIALIZED = 'INITIALIZED',
    RUNNING = 'RUNNING', 
    STOPPED = 'STOPPED', 
    STOPPING = 'STOPPING', 
    DRAINING = 'DRAINING', 
    DRAINED = 'DRAINED', 
    FAILED = 'FAILED',
}

export enum WorkFlows{
    VALIDATE_CONNECTION = 'ValidateConnectionWorkflow',
    LIST_PATHS = 'ListPathsWorkflow',
    DISCOVERY = 'discoveryWorkflow',
    PRECHECK='PreCheckValidationWorkflow',
    VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY = 'ValidateExportPathAndWorkingDirectoryWorkflow',
    VALIDATE_PATHS = 'ValidatePathsWorkflow'
}

export enum Platform {
    LINUX = 'LINUX',
    WINDOWS = 'WINDOWS',
    MACOS = 'MACOS',
    OTHER = 'OTHER'
}