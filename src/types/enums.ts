export enum JobType {
  VALIDATE_CONNECTION = 'validate_connection',
  DISCOVERY = 'discovery',
  MIGRATION = 'migration',
  CUTOVER = 'cutover',
  SPEED_TEST = 'speed_test',
}

export enum JobStatus {
  Pending = 'PENDING',
  Running = 'RUNNING',
  Success = 'SUCCESS',
  Failed = 'FAILED',
  Paused = 'PAUSED',
  Stopped = 'STOPPED'
}