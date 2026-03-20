
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
// TODO: Deprecate
export enum TaskStatus {
    Pending = 'PENDING',
    Running = 'RUNNING',
    Errored = 'ERRORED',
    Completed = 'COMPLETED',
}

export enum  JobServiceJobType {
    MIGRATE = 'MIGRATE',
    CUT_OVER = 'CUT_OVER',
    DISCOVER= 'DISCOVER',
    SPEED_TEST= 'SPEED_TEST'
}

export interface UpdateCutOverStatusInput {
    jobRunId: string;
    status: CutOverStatus
}

export enum CutOverStatus {
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export interface UpdateStatusOutput{
    message: string;
}

export interface UpdateStatusInput{
    jobRunId: string;
    status: JobRunStatus
}

export enum ServerType {
  other = 'OtherNAS',
  dell = 'Dell',
  emc = 'emc'
}