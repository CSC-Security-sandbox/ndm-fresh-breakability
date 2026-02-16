export enum JobStatus {
  Active = 'ACTIVE',
  InActive = 'IN_ACTIVE',
}

export enum JobRunStatus {
  Ready = 'READY',
  Pending = 'PENDING',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Pausing = 'PAUSING',
  Stopped = 'STOPPED',
  Stopping = 'STOPPING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Errored = 'ERRORED',
  Blocked = 'BLOCKED',
}

export enum JobType {
  DISCOVER = 'DISCOVER',
  SPEED_TEST = 'SPEED_TEST',
  MIGRATE = 'MIGRATE',
  CUT_OVER = 'CUT_OVER',
  PRECHECK = 'PRECHECK',
}

/**
 * Job run statuses that indicate an actively running job.
 */
export const RUNNING_STATUSES = [
  JobRunStatus.Running,
  JobRunStatus.Pending,
  JobRunStatus.Pausing,
  JobRunStatus.Stopping,
];
