import { RunningScanTaskCollection, RunningSyncTaskCollection } from 'src/redis/hmap-collection';
import { GroupReaderType } from './enums';
import { JobConfig } from './job-config';
import { JobState } from './job-state';
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
  jobState: JobState;
  jobRunStatus: string;
  errorsInfo: ErrorCollection;
  filesInfo: FileCollection;
  dirsInfo: DirectoryCollection;
  taskStats: TaskStatsCollection;
  migrateTask: MigrationTaskCollection;
  tasksInfo: TaskCollection;
  updatedTaskInfo :UpdatedTaskCollection
  protected stats: Map<string, number>;
  runningSyncTask: RunningSyncTaskCollection;
  runningScanTask: RunningScanTaskCollection;;


  constructor(jobRunId: string, jobConfig?: JobConfig, jobRunStatus?: string, jobState?: JobState) {
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

  async *readFiles(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.readAndPurge(readerName,batchSize,groupType);
  }

  async *groupReadFiles(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<FileInfo> {
    yield* this.filesInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readDirs(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.readAndPurge(readerName,batchSize,groupType);
  }

  async *groupReadDirs(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<FileInfo> {
    yield* this.dirsInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readTasks(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    yield* this.tasksInfo.readAndPurge(readerName,batchSize,groupType);
  }

  async *groupReadTasks(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    yield* this.tasksInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readTaskStats(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<TaskStats> {
    yield* this.taskStats.readAndPurge(readerName,batchSize,groupType);
  }

  async *groupReadTaskStats(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<TaskStats> {
    yield* this.taskStats.groupRead(readerName,batchSize,groupType);
  }

  async *groupReadMigrationTask(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    yield* this.migrateTask.groupRead(readerName,batchSize,groupType);
  }

  async *readMigrationTask(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    yield* this.migrateTask.readAndPurge(readerName,batchSize,groupType);
  }

  async *readErrors(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<DMError> {
    yield* this.errorsInfo.readAndPurge(readerName,batchSize,groupType);
  }

  async *groupReadErrors(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<DMError> {
    yield* this.errorsInfo.groupRead(readerName,batchSize,groupType);
  }

  async *readUpdatedTaskInfo(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    yield* this.updatedTaskInfo.readAndPurge(readerName,batchSize,groupType);
  }

  async *groupReadUpdatedTaskInfo(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<Task> {
    yield* this.updatedTaskInfo.groupRead(readerName,batchSize,groupType);
  }

  async getSyncTask(key: string): Promise<Task> {
    return this.runningSyncTask.getValue(key);
  }

  async getScanTask(key: string): Promise<Task> {
    return this.runningScanTask.getValue(key);
  }

  async setSyncTask(key: string, syncTask: Task): Promise<void> {
    this.runningSyncTask.setValue(key, syncTask);
  }

  async setScanTask(key: string, scanTask: Task): Promise<void> {
    this.runningScanTask.setValue(key, scanTask);
  }

  async deleteSyncTask(key: string): Promise<void> {
    await this.runningSyncTask.deleteValue(key);
  }

  async deleteScanTask(key: string): Promise<void> {
    await this.runningScanTask.deleteValue(key);
  }

  // TODO: delete not used anymore
  async assignScanTaskToSelf(key: string): Promise<Task | null> {
    return await this.runningScanTask.assignToSelf(key);
  }

  // TODO: delete not used anymore
  async assignSyncTaskToSelf(key: string): Promise<Task | null> {
    return await this.runningSyncTask.assignToSelf(key);
  }

  async getAllRunningScanTasks(): Promise<Task[]> {
    return await this.runningScanTask.getAll();
  }

  async getAllRunningSyncTasks(): Promise<Task[]> {
    return await this.runningSyncTask.getAll();
  }

  async deleteAllScanTasks(): Promise<void> {
    await this.runningScanTask.deleteAll();
  }

  async deleteAllSyncTasks(): Promise<void> {
    await this.runningSyncTask.deleteAll();
  }

  async getFilesLength(): Promise<number> {
    return await this.filesInfo.getLength();
  }
  async getDirsLength(): Promise<number> {
    return await this.dirsInfo.getLength();
  }
  async getErrorsLength(): Promise<number> {
    return await this.errorsInfo.getLength();
  }
  async getTasksLength(): Promise<number> {
    return await this.tasksInfo.getLength();
  }
  async getTaskStatsLength(): Promise<number> {
    return await this.taskStats.getLength();
  }
  async getMigrationTaskLength(): Promise<number> {
    return await this.migrateTask.getLength();
  }
  async getUpdatedTaskLength(): Promise<number> {
    return await this.updatedTaskInfo.getLength();
  }

  async getRunningSyncTaskLength(): Promise<number> {
    return await this.runningSyncTask.getSize();
  }
  async getRunningScanTaskLength(): Promise<number> {
    return await this.runningScanTask.getSize();
  }
  async isRunningSyncTaskEmpty(): Promise<boolean> {
    return await this.runningSyncTask.isEmpty();
  }
  async isRunningScanTaskEmpty(): Promise<boolean> {
    return await this.runningScanTask.isEmpty();    
  }

  async ackDirAndCreateTask(groupType: GroupReaderType, ids: string[], tasks: Task[]) {
    return await this.dirsInfo.ackAndCreateTask(groupType, ids, tasks);
  }

  async *groupReadWithoutAckDirs(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: FileInfo; id: string; }> {
    yield* this.dirsInfo.groupReadWithoutAck(readerName, batchSize,groupType);
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
