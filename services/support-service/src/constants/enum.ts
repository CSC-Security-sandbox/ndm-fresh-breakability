export enum SupportBundleStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ConfigStatus {
  ACTIVE = 'ACTIVE',
  DRAFT = 'DRAFT',
  ERRORED = 'ERRORED',
  IN_PROGRESS = 'IN_PROGRESS',
}

export enum WorkerStatus {
  Online = 'Online',
  Offline = 'Offline',
}

export enum ExportPathSource {
  AUTO_DISCOVER = 'AUTO_DISCOVER',
  MANUAL_UPLOAD = 'MANUAL_UPLOAD',
}

export enum Protocol {
  NFS = 'NFS',
  SMB = 'SMB',
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
  emc = 'emc',
}

export enum JobRunStatus {
  Ready = 'READY',
  Pending = 'PENDING',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Stopped = 'STOPPED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Errored = 'ERRORED',
}

export enum PausedReason {
  USER_PAUSED = 'USER_PAUSED',
  SYSTEM_PAUSED = 'SYSTEM_PAUSED',
}

export enum OperationStatus {
  READY = 'READY',
  IN_PROCESS = 'IN_PROCESS',
  ERROR = 'ERROR',
  COMPLETED = 'COMPLETED',
}

export enum OperationType {
  SCAN = 'SCAN',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  ERRORED = 'ERRORED',
  COMPLETED = 'COMPLETED',
}

export enum TaskOperation {
  SCAN_PATH = 'SCAN_PATH',
  COPY_FILE = 'COPY_FILE',
  META_STAMP = 'META_STAMP',
}

export enum TaskType {
  SCAN = 'SCAN',
  COPY = 'COPY',
}
