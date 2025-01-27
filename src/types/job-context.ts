import { JobConfig } from './job-config';
import { DMError, FileInfo, TaskStats, Task } from './metadata-types';
import {
  FileCollection,
  ErrorCollection,
  DirectoryCollection,
  TaskCollection,
  TaskStatsCollection,
} from './stream-collection';

export abstract class JobContext {
  jobRunId: string;
  jobConfig: JobConfig;
  jobRunStatus: string;
  errorsInfo: ErrorCollection;
  filesInfo: FileCollection;
  dirsInfo: DirectoryCollection;
  taskStats: TaskStatsCollection;
  tasksInfo: TaskCollection;
  protected stats: Map<string, number>;

  constructor(jobRunId: string, jobConfig?: JobConfig, jobRunStatus?: string) {
    this.jobRunId = jobRunId;
    if (jobConfig)
      this.jobConfig = jobConfig;
    if (jobRunStatus)
      this.jobRunStatus = jobRunStatus;
    this.stats = new Map<string, number>();
  }

  abstract init(): Promise<void>;
  abstract close(): Promise<void>;
  abstract cleanup(): Promise<void>;

  incrementStats(statName: string, value: number): number {
    if (this.stats.has(statName)) {
      this.stats.set(statName, this.stats.get(statName)! + value);
    } else {
      this.stats.set(statName, value);
    }
    return this.stats.get(statName)!;
  }

  getStat(statName: string): number {
    return this.stats.get(statName) || 0;
  }

  getJobRunId(): string {
    return this.jobRunId;
  }

  getJobRunStatus(): string {
    return this.jobRunStatus;
  }

  getJobConfig(): JobConfig {
    return this.jobConfig;
  }

  async appendToFileList(fileInfo: FileInfo): Promise<string> {
    return await this.filesInfo.append(fileInfo);
  }

  async appendToDirList(dirInfo: FileInfo): Promise<string> {
    return await this.dirsInfo.append(dirInfo);
  }

  async appendToTaskStats(taskStats: TaskStats): Promise<string> {
    return await this.taskStats.append(taskStats);
  }

  async appendToTaskList(task: Task): Promise<string> {
    return await this.tasksInfo.append(task);
  }

  async appendToErrorList(errorInfo: DMError): Promise<string> {
    return await this.errorsInfo.append(errorInfo);
  }

  async *readFiles(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.read(readerName);
  }

  async *groupReadFiles(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.groupRead(readerName);
  }

  async *readDirs(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.read(readerName);
  }

  async *groupReadDirs(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.groupRead(readerName);
  }

  async *readTasks(readerName: string): AsyncGenerator<Task> {
    yield* this.tasksInfo.read(readerName);
  }

  async *groupReadTasks(readerName: string): AsyncGenerator<Task> {
    yield* this.tasksInfo.groupRead(readerName);
  }

  async *readTaskStats(readerName: string): AsyncGenerator<TaskStats> {
    yield* this.taskStats.read(readerName);
  }

  async *groupReadTaskStats(readerName: string): AsyncGenerator<TaskStats> {
    yield* this.taskStats.groupRead(readerName);
  }

  async *readErrors(readerName: string): AsyncGenerator<DMError> {
    yield* this.errorsInfo.read(readerName);
  }

  async *groupReadErrors(readerName: string): AsyncGenerator<DMError> {
    yield* this.errorsInfo.groupRead(readerName);
  }

  serialize(): string {
    const info = {
      jobRunId: this.jobRunId,
      jobConfig: JSON.stringify(this.jobConfig),
      filesInfo: this.filesInfo
        ? {
            numMessages: this.filesInfo.numMessages,
            lastId: this.filesInfo.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
      dirsInfo: this.dirsInfo
        ? {
            numMessages: this.dirsInfo.numMessages,
            lastId: this.dirsInfo.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
      errorsInfo: this.errorsInfo
        ? {
            numMessages: this.errorsInfo.numMessages,
            lastId: this.errorsInfo.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
      tasksInfo: this.tasksInfo
        ? {
            numMessages: this.tasksInfo.numMessages,
            lastId: this.tasksInfo.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
    };
    return JSON.stringify(info);
  }

  deserialize(json: string) {
    return JSON.parse(json);
  }
}
