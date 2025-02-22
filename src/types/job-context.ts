import { JobConfig } from './job-config';
import { DMError, FileInfo, TaskStats, Task } from './metadata-types';
import {
  FileCollection,
  ErrorCollection,
  DirectoryCollection,
  TaskCollection,
  TaskStatsCollection,
  UpdatedTaskCollection,
  MigrationTaskCollection,

} from './stream-collection';

export abstract class JobContext {
  jobRunId: string;
  jobConfig: JobConfig;
  jobRunStatus: string;
  errorsInfo: ErrorCollection;
  filesInfo: FileCollection;
  dirsInfo: DirectoryCollection;
  taskStats: TaskStatsCollection;
  migrateTask: MigrationTaskCollection;
  tasksInfo: TaskCollection;
  updatedTaskInfo :UpdatedTaskCollection
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

  setStat(statName, value: number): number {
    this.stats.set(statName, value);
    return value;
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

  async appendToMigrationTask(task: Task): Promise<string> {
    return await this.migrateTask.append(task);
  }

  async appendToTaskList(task: Task): Promise<string> {
    return await this.tasksInfo.append(task);
  }

  async appendToErrorList(errorInfo: DMError): Promise<string> {
    return await this.errorsInfo.append(errorInfo);
  }

  async appendToUpdatedTaskList(task: Task): Promise<string> {
    return await this.updatedTaskInfo.append(task);
  }

  async *readFiles(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.read(readerName);
  }

  async *groupReadFiles(readerName: string,batchSize:number): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.groupRead(readerName,batchSize);
  }

  async *readDirs(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.read(readerName);
  }

  async *groupReadDirs(readerName: string,batchSize:number): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.groupRead(readerName,batchSize);
  }

  async *readTasks(readerName: string): AsyncGenerator<Task> {
    yield* this.tasksInfo.read(readerName);
  }

  async *groupReadTasks(readerName: string,batchSize:number): AsyncGenerator<Task> {
    yield* this.tasksInfo.groupRead(readerName,batchSize);
  }

  async *readTaskStats(readerName: string): AsyncGenerator<TaskStats> {
    yield* this.taskStats.read(readerName);
  }

  async *groupReadTaskStats(readerName: string,batchSize:number): AsyncGenerator<TaskStats> {
    yield* this.taskStats.groupRead(readerName,batchSize);
  }

  async *groupReadMigrationTask(readerName: string,batchSize:number): AsyncGenerator<Task> {
    yield* this.migrateTask.groupRead(readerName,batchSize);
  }

  async *readMigrationTask(readerName: string): AsyncGenerator<Task> {
    yield* this.migrateTask.read(readerName);
  }

  async *readErrors(readerName: string): AsyncGenerator<DMError> {
    yield* this.errorsInfo.read(readerName);
  }

  async *groupReadErrors(readerName: string,batchSize:number): AsyncGenerator<DMError> {
    yield* this.errorsInfo.groupRead(readerName,batchSize);
  }

  async *readUpdatedTaskInfo(readerName: string): AsyncGenerator<Task> {
    yield* this.updatedTaskInfo.read(readerName);
  }

  async *groupReadUpdatedTaskInfo(readerName: string,batchSize:number): AsyncGenerator<Task> {
    yield* this.updatedTaskInfo.groupRead(readerName,batchSize);
  }

  serialize(): string {
    const info = {
      jobRunId: this.jobRunId,
      jobConfig: this.jobConfig,
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
      migrateTask: this.migrateTask
        ? {
            numMessages: this.migrateTask.numMessages,
            lastId: this.migrateTask.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
      taskStats: this.taskStats
        ? {
            numMessages: this.taskStats.numMessages,
            lastId: this.taskStats.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
      updatedTaskInfo: this.updatedTaskInfo
        ? {
            numMessages: this.updatedTaskInfo.numMessages,
            lastId: this.updatedTaskInfo.lastId,
          }
        : { numMessages: 0, lastId: '0-0' },
    };
    return JSON.stringify(info);
  }

  deserialize(json: string) {
    return JSON.parse(json);
  }
}
