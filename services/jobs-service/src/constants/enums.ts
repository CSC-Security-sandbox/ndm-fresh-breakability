// -------------- worker ------------- //
export enum WorkerStatus {
  Online = "Online",
  Offline = "Offline",
}

// -------------- Protocol ------------- //
export enum Protocol {
  NFS = "NFS",
  SMB = "SMB",
}

// -------------- Config ------------- //
export enum ServerType {
  other = "OtherNAS",
  dell = "dell",
  emc = "emc",
}

export enum ConfigurationType {
  file = "FILE",
  objectStorage = "OBJECT_STORAGE",
}

// ---------- Job -----------/

export enum JobStatus {
  Active = "ACTIVE",
  InActive = "IN_ACTIVE",
}

export enum JobConfigBulkMigrateResStatus {
  CREATED = "CREATED",
  FAILED = "FAILED",
}

export enum JobType {
  DISCOVER = "DISCOVER",
  SPEED_TEST = "SPEED_TEST",
  MIGRATE = "MIGRATE",
  CUT_OVER = "CUT_OVER",
  PRECHECK = "PRECHECK",
}

export enum JobIdMappingType {
  Gid = "GID",
  Uid = "UID",
  Sid = "SID",
}

export enum TemplateType {
  GID = "gid",
  UID = "uid",
  SID = "sid",
}

// ---------- Job Run -----------/
export enum JobRunStatus {
  Ready = "READY",
  Pending = "PENDING",
  Running = "RUNNING",
  Paused = "PAUSED",
  Pausing = "PAUSING",
  Stopped = "STOPPED",
  Stopping = "STOPPING",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Errored = "ERRORED",
  Blocked = "BLOCKED",
}

export enum TaskType {
  Scan = "SCAN",
  Migrate = "MIGRATE",
  Copy = "COPY",
}

// -------------- Task ------------- //

export enum TaskStatus {
  Pending = "PENDING",
  Running = "RUNNING",
  Errored = "ERRORED",
  Completed = "COMPLETED",
}

export enum TaskOperation {
  ScanPath = "SCAN_PATH",
  CopyFile = "COPY_FILE",
  MetaStamp = "META_STAMP",
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

// -------------- QueueEvent ------------- //
export enum RabbitMq {
  ListPaths = "ListPaths",
  CreateTaskList = "taskList",
}

export enum WorkFlowType {
  PARENT_WORKFLOW = "parent-workflow-tasks",
  WORKER_SPECIFIC_WORKFLOW = "worker-specific-tasks",
}

export enum WorkFlows {
  DISCOVERY = "DiscoveryWorkflow",
  SPEED_TEST = "SpeedTestWorkflow",
  PRECHECK = "PreCheckValidationWorkflow",
  MIGRATE = "MigrationWorkflow",
  CUT_OVER = "CutOverWorkFlow",
}

export enum ConsumerType {
  files = "files",
  directories = "directories",
  tasks = "tasks",
  updatedTask = "updatedTask",
  errors = "errors",
  migrationTask = "migrationTask",
  speedtestTask = "speedtestTask",
}

export enum CutoverErrors {
  VALID_JOB_RUN_NOT_FOUND = "VALID_JOB_RUN_NOT_FOUND",
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

export enum CutOverStatus {
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export enum PausedReason {
  USER_PAUSED = "USER_PAUSED",
  SYSTEM_PAUSED = "SYSTEM_PAUSED",
}

export enum Platform {
  LINUX = "LINUX",
  WINDOWS = "WINDOWS",
  MACOS = "MACOS",
  OTHER = "OTHER",
}

export const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  PiB: 1024 ** 5,
};

export enum JobConfigurationEnum {
  skipFile = "Skip Files modified in last",
  preserveAccessTime = "Preserve a-time",
  excludeFilePatterns = "Excluded Path Patterns",
  excludeOlderThan = "Exclude file older than (UTC)",
  futureScheduleAt = "Incremental sync schedule",
}