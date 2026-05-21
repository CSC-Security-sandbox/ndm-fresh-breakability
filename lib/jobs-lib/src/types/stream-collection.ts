
import { Cmd, ItemInfo, TaskInfo } from '../datatype/stream-datatypes';
import { GroupReaderType } from './enums';
import { FileInfo, DMError, TaskStats, Task, SpeedTestReadWriteInfo } from './metadata-types';
import { Serializable } from './serializable';

export interface Message<T> {
  id: string;
  data: T;
}

export interface StreamCollection<T extends Serializable> {
  jobRunId: string;
  streamKey: string;
  numMessages: number;
  lastId: string;
  consumerGroupCount: number;

  init(): Promise<void>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
  append(record: T): Promise<string>;
  appendBulk(record: T[]): Promise<string[]>;
  read(readerName: string): AsyncGenerator<T>;
  groupRead(readerName: string,batchSize:number, groupType: GroupReaderType): AsyncGenerator<T>;
  readAndPurge(readerName: string,batchSize:number, groupType: GroupReaderType): AsyncGenerator<T>;
  getLength(): Promise<number>;
  ackAndPurge(ids: string[], groupType: GroupReaderType): Promise<boolean>;
  groupReadWithoutAck(readerName: string,batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: T; id: string; }>;
  drainPendingEntries(readerName: string, batchSize: number, groupType: GroupReaderType): AsyncGenerator<{ data: T; id: string; }>;
}

export interface FileCollection extends StreamCollection<FileInfo> {}
export interface ErrorCollection extends StreamCollection<DMError> {}
export interface DirectoryCollection extends StreamCollection<FileInfo> {
  ackAndCreateTask(groupType: GroupReaderType, ids: string[], tasks: Task[]);
}
export interface SpeedTestReadWriteCollection extends StreamCollection<SpeedTestReadWriteInfo> {}
export interface TaskStatsCollection extends StreamCollection<TaskStats> {}
export interface TaskCollection extends StreamCollection<Task> {}
export interface UpdatedTaskCollection extends StreamCollection<Task> {}
export interface MigrationTaskCollection extends StreamCollection<Task> {}

export interface CommandCollection extends StreamCollection<Cmd> {}
export interface ItemInfoCollection extends StreamCollection<ItemInfo> {}
export interface TaskInfoCollection extends StreamCollection<TaskInfo> {}
