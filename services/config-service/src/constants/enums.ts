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
    VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY = 'ValidateWorkingDirectoryWorkflow',
    VALIDATE_PATHS = 'ValidatePathsWorkflow',
    SUPPORT_BUNDLE_WORKFLOW = 'SupportBundleWorkflow',
}

export enum ProtocolVersionError{
    PROTOCOL_VERSION_ERROR = 'The server does not support to provided protocol version. Please use a valid protocol version.'
}

export enum Platform {
    LINUX = 'LINUX',
    WINDOWS = 'WINDOWS',
    MACOS = 'MACOS',
    OTHER = 'OTHER'
}

export enum UploadPathAction {
    CREATE = 'CREATE',
    DUPLICATE = 'DUPLICATE',
    DELETE = 'DELETE',
}

export enum ExportPathSource {
    AUTO_DISCOVER = 'AUTO_DISCOVER',
    MANUAL_UPLOAD = 'MANUAL_UPLOAD',
}

export enum ScheduleStatus {
    SCHEDULING = 'SCHEDULING',
    SCHEDULED = 'SCHEDULED',
    READY_TO_BE_SCHEDULED = 'READY_TO_BE_SCHEDULED'
}

export enum SupportBundleStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum UserRoles {
  APP_ADMIN = 'App Admin',
  PROJECT_ADMIN = 'Project Admin',
  PROJECT_VIEWER = 'Project Viewer'
}

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

export enum JobRunStatus {
  Ready = "READY",
  Pending = "PENDING",
  Running = "RUNNING",
  Paused = "PAUSED",
  Stopped = "STOPPED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Errored = "ERRORED",
}

export enum PausedReason {
  USER_PAUSED = "USER_PAUSED",
  SYSTEM_PAUSED = "SYSTEM_PAUSED",
}

export enum OperationStatus {
  READY = "READY",
  IN_PROCESS = "IN_PROCESS",
  ERROR = "ERROR",
  COMPLETED = "COMPLETED",
}

export enum OperationType {
  SCAN = "SCAN",
}

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