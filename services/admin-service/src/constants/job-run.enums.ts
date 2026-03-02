export enum JobRunStatus {
    Ready = 'READY',
    Running = 'RUNNING',
    Paused = 'PAUSED',
    Pausing = 'PAUSING',
    Stopped = 'STOPPED',
    Stopping = 'STOPPING',
    Completed = 'COMPLETED',
    Failed = 'FAILED',
    Errored = 'ERRORED',
    Blocked = 'BLOCKED',
    Pending = 'PENDING',
  }

export enum JobRunType {
  REGULAR = "REGULAR",
  RETRY = "RETRY",
}

export enum PausedReason {
  USER_PAUSED = "USER_PAUSED",
  SYSTEM_PAUSED = "SYSTEM_PAUSED",
}

export interface JobRunStats {
  lastRefreshed?: Date;
  fileCount: string;
  directories: string;
  totalSize: string;
  errors: [];
}

export class WorkerConfiguration {
  workerId: string;
  configName: string;
  taskQueueId: string;
  dynamicTaskQueue: boolean;
}