import { SpeedTestJobConfig } from './speed-test-job-config';
import { JobState } from './job-state';
import { DMError, FileInfo, TaskStats, Task, SpeedTestReadWriteInfo } from './metadata-types';
import {
  FileCollection,
  ErrorCollection,
  DirectoryCollection,
  TaskCollection,
  TaskStatsCollection,
  UpdatedTaskCollection,
  MigrationTaskCollection,
  SpeedTestReadWriteCollection,

} from './stream-collection';
import { GroupReaderType } from './enums';

export abstract class SpeedTestJobContext {
  jobRunId: string;
  jobConfig: SpeedTestJobConfig;
  jobState: JobState;
  jobRunStatus: string;
  errorsInfo: ErrorCollection;
  filesInfo: FileCollection;
  dirsInfo: DirectoryCollection;
  taskStats: TaskStatsCollection;
  speedTestReadWritesData: SpeedTestReadWriteCollection;
  migrateTask: MigrationTaskCollection;
  tasksInfo: TaskCollection;
  updatedTaskInfo :UpdatedTaskCollection
  protected stats: Map<string, number>;

  constructor(jobRunId: string, jobConfig?: SpeedTestJobConfig, jobRunStatus?: string, jobState?: JobState) {
    this.jobRunId = jobRunId;
    if (jobConfig)
      this.jobConfig = jobConfig;
    if (jobRunStatus)
      this.jobRunStatus = jobRunStatus;
    if (jobState)
      this.jobState = jobState;
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

  getJobState(): JobState {
    return this.jobState;
  }

  setJobState(jobState): JobState {
    this.jobState = jobState;
    return jobState;
  }

  getJobRunId(): string {
    return this.jobRunId;
  }

  getJobRunStatus(): string {
    return this.jobRunStatus;
  }

  getJobConfig(): SpeedTestJobConfig {
    return this.jobConfig;
  }

  async appendToFileList(fileInfo: FileInfo): Promise<string> {
    return await this.filesInfo.append(fileInfo);
  }


  async appendToSpeedTestReadWriteInfo(speedTestReadWriteInfo: SpeedTestReadWriteInfo): Promise<string> {
    return await this.speedTestReadWritesData.append(speedTestReadWriteInfo);
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
    console.log('[Jobs Lib] Appending task to task list -> ', JSON.stringify(task));
    return await this.tasksInfo.append(task);
  }

  async appendToErrorList(errorInfo: DMError): Promise<string> {
    console.log('[Jobs Lib] Appending error to error list -> ', JSON.stringify(errorInfo));
    return await this.errorsInfo.append(errorInfo);
  }

  async appendToUpdatedTaskList(task: Task): Promise<string> {
    console.log('[Jobs Lib] Appending task to updated task list -> ', JSON.stringify(task));
    return await this.updatedTaskInfo.append(task);
  }

  async *readFiles(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.read(readerName);
  }

  async *speedTestReadWriteTask(readerName: string): AsyncGenerator<SpeedTestReadWriteInfo> {
    console.log('[Jobs Lib] Read speed Test Read Write speed task -> ', JSON.stringify(readerName));
    yield* this.speedTestReadWritesData.read(readerName);
  }

  async *groupReadFiles(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readDirs(readerName: string): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.read(readerName);
  }

  async *groupReadDirs(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<FileInfo> {
    console.log('[Jobs Lib] Group read dirs -> ', JSON.stringify(readerName), JSON.stringify(batchSize));
    yield* this.dirsInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readTasks(readerName: string): AsyncGenerator<Task> {
    yield* this.tasksInfo.read(readerName);
  }

  async *groupReadTasks(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    console.log('[Jobs Lib] Group read tasks -> ', JSON.stringify(readerName), JSON.stringify(batchSize));
    yield* this.tasksInfo.groupRead(readerName,batchSize,groupType);
  }


  async *readTaskStats(readerName: string): AsyncGenerator<TaskStats> {
    console.log('[Jobs Lib] Read task stats -> ', JSON.stringify(readerName));
    yield* this.taskStats.read(readerName);
  }

  async *groupReadTaskStats(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<TaskStats> {
    console.log('[Jobs Lib] Group read task stats -> ', JSON.stringify(readerName), JSON.stringify(batchSize));
    yield* this.taskStats.groupRead(readerName,batchSize,groupType);
  }

  async *groupReadMigrationTask(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    console.log('[Jobs Lib] Group read migration task -> ', JSON.stringify(readerName), JSON.stringify(batchSize));
    yield* this.migrateTask.groupRead(readerName,batchSize,groupType);
  }

  async *readMigrationTask(readerName: string): AsyncGenerator<Task> {
    console.log('[Jobs Lib] Read migration task -> ', JSON.stringify(readerName));
    yield* this.migrateTask.read(readerName);
  }

  async *readErrors(readerName: string): AsyncGenerator<DMError> {
    yield* this.errorsInfo.read(readerName);
  }

  async *groupReadErrors(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<DMError> {
    console.log('[Jobs Lib] Group read errors -> ', JSON.stringify(readerName), JSON.stringify(batchSize));
    yield* this.errorsInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readUpdatedTaskInfo(readerName: string): AsyncGenerator<Task> {
    console.log('[Jobs Lib] Read updated task info -> ', JSON.stringify(readerName));
    yield* this.updatedTaskInfo.read(readerName);
  }

  async *groupReadUpdatedTaskInfo(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    console.log('[Jobs Lib] Group read updated task info -> ', JSON.stringify(readerName), JSON.stringify(batchSize));
    yield* this.updatedTaskInfo.groupRead(readerName,batchSize,groupType);
  }

  serialize(): string {
    const info = {
      jobRunId: this.jobRunId,
      jobConfig: this.jobConfig,
      jobState: this.jobState,
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
        speedTestReadWritesData: this.speedTestReadWritesData
      ? {
        numMessages: this.speedTestReadWritesData.numMessages,
        lastId: this.speedTestReadWritesData.lastId,
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
