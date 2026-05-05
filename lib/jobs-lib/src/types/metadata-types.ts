import { CommandStatus, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from "./enums";
import { Serializable } from "./serializable";

export class FileInfo implements Serializable {
  fileName: string;
  path: string;
  parentPath: string;
  isDirectory: boolean;
  fileSize: number;
  isFile: boolean;
  birthTime: Date;
  modifiedTime: Date;
  accessTime: Date;
  extension: string;
  permission: string;
  fileType: string;
  depth: number;
  uid?: number;
  gid?: number;
  sid?: string;

  constructor(
    fileName: string,
    path: string,
    parentPath: string,
    isDirectory: boolean,
    fileSize: number,
    isFile: boolean,
    birthTime: Date,
    modifiedTime: Date,
    accessTime: Date,
    extension: string,
    permission: string,
    fileType: string,
    depth: number,
    uid?: number,
    gid?: number,
    sid?: string,
  ) {
    this.fileName = fileName;
    this.path = path;
    this.parentPath = parentPath;
    this.isDirectory = isDirectory;
    this.fileSize = fileSize;
    this.isFile = isFile;
    this.birthTime = birthTime;
    this.modifiedTime = modifiedTime;
    this.accessTime = accessTime;
    this.extension = extension;
    this.permission = permission;
    this.fileType = fileType;
    this.depth = depth;
    this.uid = uid;
    this.gid = gid;
    this.sid = sid;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  static deserialize(serialized: string): FileInfo {
    return JSON.parse(serialized);
  }        
}

export class SpeedTestReadWriteInfo implements Serializable {
  timeStamp: string;
  speed: string;
  testType: string;
  jobRunId: string;
  
  constructor(
    timeStamp: string,
    speed: string,
    testType: string,
    jobRunId: string,
  ) {
    this.timeStamp = timeStamp;
    this.speed = speed
    this.testType = testType;
    this.jobRunId = jobRunId;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  static deserialize(serialized: string): FileInfo {
    return JSON.parse(serialized);
  }        
}

export enum TaskStatsType {
  numFiles = 'Number of Files',
  numDirs = 'Number of Dirs',
  numErrors = 'Number of Errors',
}

export class TaskStats implements Serializable {
  numFiles: number = 0;
  numDirs: number = 0;
  numErrors: number = 0;
  taskName: string = '';

  constructor(taskName: string) {
    this.taskName = taskName;
  }

  increment(key: TaskStatsType, value: number): void {
    switch (key) {
      case TaskStatsType.numFiles:
        this.numFiles += value;
        break;
      case TaskStatsType.numDirs:
        this.numDirs += value;
        break;
      case TaskStatsType.numErrors:
        this.numErrors += value;
        break;
    }
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  static deserialize(serialized: string): TaskStats {
    return JSON.parse(serialized);
  }
}



export class MetaData{
  size: number;
  mtime: Date;
  atime: Date;
  ctime: Date;
  birthtime: Date;
  mode: number;
  uid: number;
  gid: number;
  sid: string;
}

export class CommandOperation {
  cmd: OPS_CMD;
  status: OPS_STATUS;
  error?: string;
  errorCode?: string;
  metadata?: MetaData
}

export class Command implements Serializable {
  fPath: string;
  ops: Record<number, CommandOperation>;
  status: CommandStatus;
  commandId: string;
  retryCount: number = 0;

  constructor(
    fPath: string,
    ops: Record<number, CommandOperation>,
    commandId: string,
    retryCount: number,
  ) {
    this.fPath = fPath;
    this.ops = ops;
    this.commandId = commandId;
    this.retryCount = retryCount;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  static deserialize(serialized: string): Command {
    return JSON.parse(serialized);
  }
}

export class Task implements Serializable {
  id: string;
  jobRunId: string;
  taskType: TaskType;
  status: TaskStatus;
  workerId: string;
  sPath: string;
  sPathId: string;
  tPath?: string | null;
  tPathId?: string | null;
  excludeFilePatterns?: string;
  commands: Command[];

  constructor(
    id: string,
    jobRunId: string,
    taskType: TaskType,
    status: TaskStatus,
    workerId: string,
    sPath: string,
    sPathId: string,
    commands: Command[],
    tPath?: string,
    tPathId?: string,
    excludeFilePatterns?: string,
  ) {
    this.id = id;
    this.jobRunId = jobRunId;
    this.taskType = taskType;
    this.status = status;
    this.workerId = workerId;
    this.sPath = sPath;
    this.tPath = tPath;
    this.sPathId = sPathId,
    this.tPathId = tPathId;
    this.excludeFilePatterns = excludeFilePatterns;
    this.commands = commands;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  static deserialize(serialized: string): Task {
    return JSON.parse(serialized);
  }
}

export class DMError implements Serializable {
tasks: TaskError;
operation: OperationError;

constructor(tasks?: TaskError,operation?: OperationError) {
  this.tasks = tasks;
  this.operation = operation;
}
  serialize(): string {
    return JSON.stringify(this);
  }

  static deserialize(serialized: string): DMError {
    return JSON.parse(serialized);
  }
}

export interface TaskError{
  taskId: string;
  errorCode: string;
  errorMessage: string;
  errorType: ErrorType;
  taskType?: string;
  origin?: string;
}
export interface OperationError{
  operationId: string;
  errorCode: string;
  errorMessage: string;
  errorFiles: ErroredFile;
  errorType: ErrorType;
  operationName?: string;
  origin?: string;
  originalJobRunId?: string;  // For retry error synchronization - tracks the original job run
}
export interface ErroredFile{
  fileName: string;
  filePath: string;
}

export enum ErrorType {
  FATAL_ERROR = 'FATAL_ERROR',
  TRANSIENT_ERROR = 'TRANSIENT_ERROR',
  RECOVERABLE_ERROR = 'RECOVERABLE_ERROR',
  METADATA_UPDATE_CONFLICT = 'METADATA_UPDATE_CONFLICT',
}