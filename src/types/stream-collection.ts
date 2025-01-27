import { FileInfo, DMError, TaskStats, Task } from './metadata-types';
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

  init(): Promise<void>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
  append(record: T): Promise<string>;
  read(readerName: string): AsyncGenerator<T>;
  groupRead(readerName: string): AsyncGenerator<T>;
}

export interface FileCollection extends StreamCollection<FileInfo> {}
export interface ErrorCollection extends StreamCollection<DMError> {}
export interface DirectoryCollection extends StreamCollection<FileInfo> {}
export interface TaskStatsCollection extends StreamCollection<TaskStats> {}
export interface TaskCollection extends StreamCollection<Task> {}
