export enum JobType {
  VALIDATE_CONNECTION = 'validate_connection',
  DISCOVERY = 'discovery',
  MIGRATION = 'migration',
  CUTOVER = 'cutover',
  SPEED_TEST = 'speed_test',
}


export enum OPS_CMD {
  COPY_CONTENT = 'cc',
  STAMP_META  = 'sm', // TO-DO: make it granular
  COPY_FILE = 'cf',
  COPY_DIR = 'cd',
  REMOVE_DIR = 'rd', // This is used to remove directories
  REMOVE_FILE = 'rf', // This is used to remove files

}

export enum OPS_STATUS {
  READY = 'READY',
  IN_PROCESS = 'IN_PROCESS',
  ERROR = 'ERROR',
  COMPLETED = 'COMPLETED'
}


export enum CommandStatus {
  READY='READY',
  IN_PROCESS='IN_PROCESS',
  ERROR ='ERROR',
  COMPLETED = 'COMPLETED'
}

export enum TaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  ERRORED = 'ERRORED',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_ERROR = 'COMPLETED_WITH_ERROR',
}

export enum TaskType {
  SCAN = 'SCAN',
  MIGRATE = 'MIGRATE',
}


export enum JobStatus {
  Ready = 'READY',
  Pending = 'PENDING',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Stopped = 'STOPPED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Errored = 'ERRORED'
}

export enum IdentityTypes {
  SID = 'SID',
  UID = 'UID',
  GID = 'GID'
}

export enum GroupReaderType {
  WORKER = 'worker',
  DB_WRITER = 'db-writer',
}