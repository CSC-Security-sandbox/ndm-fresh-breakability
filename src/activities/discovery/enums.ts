
export enum JobRunStatus {
    Ready = 'READY',
    Pending = 'PENDING',
    Running = 'RUNNING',
    Paused = 'PAUSED',
    Stopped = 'STOPPED',
    Completed = 'COMPLETED',
    Failed = 'FAILED',
    BLOCKED = 'BLOCKED',
    Errored = 'ERRORED'
}

export enum TaskStatus {
    Pending = 'PENDING',
    Running = 'RUNNING',
    Errored = 'ERRORED',
    Completed = 'COMPLETED',
}
export enum OperationStatus{
    READY='READY',
    IN_PROCESS='IN_PROCESS',
    ERROR ='ERROR',
    COMPLETED = 'COMPLETED'
}

//TODO: Need to check
export enum  JobReportType {
    MIGRATE = 'MIGRATE',
    CUT_OVER = 'CUT_OVER',
    DISCOVER= 'DISCOVER'
}