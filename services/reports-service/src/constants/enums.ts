export enum WorkerStatus {
  Online = "Online",
  Offline = "Offline",
}

export enum Protocol {
  NFS = "NFS",
  SMB = "SMB",
}

export enum ServerType {
  other = "OtherNAS",
  dell = "dell",
  emc = "emc",
}

export enum ConfigurationType {
  file = "FILE",
  objectStorage = "OBJECT_STORAGE",
}

export enum RabbitMq {
  ListPaths = "ListPaths",
}

export enum JobRunStatus {
  Ready = "READY",
  Pending = "PENDING",
  Running = "RUNNING",
  Paused = "PAUSED",
  Stopped = "STOPPED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Errored = "ERRORED",
  Blocked = "BLOCKED",
}

export const TERMINAL_JOB_RUN_STATUSES: JobRunStatus[] = [
  JobRunStatus.Completed,
  JobRunStatus.Failed,
  JobRunStatus.Errored,
  JobRunStatus.Stopped,
  JobRunStatus.Blocked,
];

export enum JobStatus {
  Active = "ACTIVE",
  InActive = "IN_ACTIVE",
}

export enum JobType {
  Discover = "DISCOVER",
  Migrate = "MIGRATE",
  CutOver = "CUT_OVER",
  SpeedTest = "SPEED_TEST",
}

// -------------- Task ------------- //

export enum TaskStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  ERRORED = "ERRORED",
  COMPLETED = "COMPLETED",
}

export enum TaskOperation {
  SCAN_PATH = "SCAN_PATH",
  COPY_FILE = "COPY_FILE",
  META_STAMP = "META_STAMP",
}

export enum TaskType {
  SCAN = "SCAN",
  COPY = "COPY",
}

export enum ReportType {
  JOB_RUN_STATS = "JobRunStats",
  COC = "COC",
  JOBS_RREPORT = "JOBS_REPORT",
  DISCOVERY = "DISCOVER",
}

export enum ReportValueType {
  SIZE = "size",
  TIME = "time",
  COUNT = "count",
  STRING = "string",
}
// ---------- Operations -----------/
export enum OperationStatus {
  READY = "READY",
  IN_PROCESS = "IN_PROCESS",
  ERROR = "ERROR",
  COMPLETED = "COMPLETED",
}

export enum OperationType {
  SCAN = "SCAN",
}

export enum ProtocolVersion {
  NFSv3 = "v3",
  NFSv4_0 = "v4.0",
  NFSv4_1 = "v4.1",
  NFSv4_2 = "v4.2",
  SMBv2_0 = "v2.0",
  SMBv3_0 = "v3.0",
  SMBv3_1_1 = "v3.1.1",
}

export enum PausedReason {
  USER_PAUSED = "USER_PAUSED",
  SYSTEM_PAUSED = "SYSTEM_PAUSED",
}
