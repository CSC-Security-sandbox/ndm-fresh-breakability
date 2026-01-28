import { Serializable } from "src/types/serializable";

export interface WorkerRunningTaskMapCollection<T extends Serializable> {
    jobRunId: string;
    mapType: string;
    redisMapKey: string;

    init(): Promise<void>;
    cleanup(): Promise<void>;
    close(): Promise<void>;

    setValue(key: string, value: T): Promise<void>;
    getAll(): Promise<any>;
    getValue(key: string): Promise<T | null>;
    deleteValue(key: string): Promise<void>;
    deleteAll(): Promise<void>;
    assignToSelf(key: string): Promise<T | null>;
    isEmpty(): Promise<boolean>;
    getSize(): Promise<number>;
    setValueIfNotExists(key: string, value: T): Promise<boolean>;
}

export interface RunningScanTaskCollection extends WorkerRunningTaskMapCollection<any> {}
export interface RunningSyncTaskCollection extends WorkerRunningTaskMapCollection<any> {}
export interface TaskMap extends WorkerRunningTaskMapCollection<any> {}
export interface DirMap extends WorkerRunningTaskMapCollection<any> {}
export interface CursorMap extends WorkerRunningTaskMapCollection<any> {}
export interface RetryBatchMap extends WorkerRunningTaskMapCollection<any> {}