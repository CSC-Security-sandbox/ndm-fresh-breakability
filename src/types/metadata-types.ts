import { Serializable } from './serializable';
import { encode, decode } from 'msgpack-lite';

export class FileInfo implements Serializable {
  fileName: string;
  path: string;
  parentPath: string;
  isDirectory: boolean;
  uid: number;
  gid: number;
  size: number;
  isFile: boolean;
  ctime: Date;
  mtime: Date;
  atime: Date;
  extension: string;
  permission: string;
  fileType: string;
  depth: number;

  constructor(
    fileName: string,
    path: string,
    parentPath: string,
    isDirectory: boolean,
    uid: number,
    gid: number,
    size: number,
    isFile: boolean,
    ctime: Date,
    mtime: Date,
    atime: Date,
    extension: string,
    permission: string,
    fileType: string,
    depth: number,
  ) {
    this.fileName = fileName;
    this.path = path;
    this.parentPath = parentPath;
    this.isDirectory = isDirectory;
    this.uid = uid;
    this.gid = gid;
    this.size = size;
    this.isFile = isFile;
    this.ctime = ctime;
    this.mtime = mtime;
    this.atime = atime;
    this.extension = extension;
    this.permission = permission;
    this.fileType = fileType;
    this.depth = depth;
  }

  serialize(): string {
    return encode(this).toString();
  }

  static deserialize(data: string): FileInfo {
    return decode(Buffer.from(data));
  }
}

export enum TaskStatsType {
  numFiles = 'Number of Files',
  numDirs = 'Number of Dirs',
  numErrors = 'Number of Errors',
}

export class TaskStats {
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
    return encode(this).toString();
  }

  static deserialize(data: string): TaskStats {
    return decode(Buffer.from(data));
  }
}

export class CommandOperation {
  cmd: string;
  status: string;
}

export class Command {
  fPath: string;
  ops: Record<number, CommandOperation>;
  commandId: string;

  constructor(
    fPath: string,
    ops: Record<number, CommandOperation>,
    commandId: string,
  ) {
    this.fPath = fPath;
    this.ops = ops;
    this.commandId = commandId;
  }

  serialize(): string {
    return encode(this).toString();
  }

  static deserialize(data: string): Command {
    return decode(Buffer.from(data));
  }
}

export class Task {
  id: string;
  jobRunId: string;
  taskType: string;
  status: string;
  workerId: string;
  sPath: string;
  tPath: string;
  excludeFilePatterns: string;
  commands: Command[];

  constructor(
    id: string,
    jobRunId: string,
    taskType: string,
    status: string,
    workerId: string,
    sPath: string,
    tPath: string,
    excludeFilePatterns: string,
    commands: Command[],
  ) {
    this.id = id;
    this.jobRunId = jobRunId;
    this.taskType = taskType;
    this.status = status;
    this.workerId = workerId;
    this.sPath = sPath;
    this.tPath = tPath;
    this.excludeFilePatterns = excludeFilePatterns;
    this.commands = commands;
  }

  serialize(): string {
    return encode(this).toString();
  }

  static deserialize(data: string): Task {
    return decode(Buffer.from(data));
  }
}

export class DMError {
  file: string;
  error: Error;

  constructor(file: string, error: Error) {
    this.file = file;
    this.error = error;
  }

  serialize(): string {
    return encode(this).toString();
  }

  static deserialize(data: string): DMError {
    return decode(Buffer.from(data));
  }
}
