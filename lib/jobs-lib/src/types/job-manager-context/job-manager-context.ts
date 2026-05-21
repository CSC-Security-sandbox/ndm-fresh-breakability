import { DirMap, TaskMap, CursorMap, RetryBatchMap } from "src/redis/hmap-collection";
import { Cmd, ItemInfo, ParquetItem, TaskInfo } from "../../datatype/stream-datatypes";
import { GroupReaderType } from "../enums";
import { JobConfig } from "../job-config";
import { DMError, Task } from "../metadata-types";
import { CommandCollection, ErrorCollection, ItemInfoCollection, ParquetCollection, TaskInfoCollection } from "../stream-collection";




export  class JobManagerContext {
    jobRunId: string;
    jobConfig: JobConfig;
    jobRunStatus: string;
    fileStream: ItemInfoCollection;
    errorStream: ErrorCollection;
    commandStream: CommandCollection;
    taskStream: TaskInfoCollection;
    parquetStream: ParquetCollection;
    taskMap: TaskMap;
    dirBatchMap: DirMap;
    cursorMap: CursorMap;
    retryBatches: RetryBatchMap;

    constructor(jobRunId: string, jobConfig?: JobConfig, jobRunStatus?: string) {
        this.jobRunId = jobRunId;
        if (jobConfig)
        this.jobConfig = jobConfig;
        if (jobRunStatus)
        this.jobRunStatus = jobRunStatus;
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

    // streams Methods

    // file stream methods
    async publishToFileStream(file: ItemInfo): Promise<string> {
        return await this.fileStream.append(file);
    }

    async publishToFileStreamBulk(files: ItemInfo[]): Promise<string[]> {
        return await this.fileStream.appendBulk(files);
    }

    async *groupReadFileStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: ItemInfo; id: string; }> {
        yield* this.fileStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }

    async groupAckFileStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.fileStream.ackAndPurge(ids, groupType);
    }

    // Error Stream Methods
    async publishToErrorStream(error: DMError, originalJobRunId?: string): Promise<string> {
        // If originalJobRunId is provided (retry scenario), add it to operation errors
        if (error.operation && originalJobRunId) {
            error.operation.originalJobRunId = originalJobRunId;
        }
        return await this.errorStream.append(error);
    }

    async *groupReadErrorStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: DMError; id: string; }> {
        yield* this.errorStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }
    
    async groupAckErrorStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.errorStream.ackAndPurge(ids, groupType);
    }

    // Command Stream Methods
    async publishToCommandStream(command: Cmd): Promise<string> {
        return await this.commandStream.append(command);
    }
       
    async publishBulkToCommandStream(commands: Cmd[]): Promise<string[]> {
        return await this.commandStream.appendBulk(commands);
    }

    async *groupReadCommandStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: Cmd; id: string; }> {
        yield* this.commandStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }

    async groupAckCommandStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.commandStream.ackAndPurge(ids, groupType);
    }

    async getCmdStreamLen(): Promise<number> {
        return this.commandStream.getLength();
    }

    async getFileStreamLen(): Promise<number> {
        return this.fileStream.getLength();
    }

    // Task Stream Methods
    async publishToTaskStream(task: TaskInfo): Promise<string> {
        return await this.taskStream.append(task);
    }
    async *groupReadTaskStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: TaskInfo; id: string; }> {
        yield* this.taskStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }
    async groupAckTaskStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.taskStream.ackAndPurge(ids, groupType);
    }

    async publishToParquetStream(item: ParquetItem): Promise<string> {
        return await this.parquetStream.append(item);
    }

    async publishToParquetStreamBulk(items: ParquetItem[]): Promise<string[]> {
        return await this.parquetStream.appendBulk(items);
    }


    // Task Map Methods
    async setTask(key: string, value: TaskInfo): Promise<void> {
        await this.taskMap.setValue(key, value);
    }

    async setTaskIfNotExists(key: string, value: TaskInfo): Promise<boolean> {
        return await this.taskMap.setValueIfNotExists(key, value);
    }

    async getTask(key: string): Promise<TaskInfo | null> {
        return await this.taskMap.getValue(key);
    }

    async deleteTask(key: string): Promise<void> {
        await this.taskMap.deleteValue(key);
    }

    async setBatchDir(key: string , value: any): Promise<void> {
        await this.dirBatchMap.setValue(key, value);
    }

    async getBatchDir(key: string): Promise<any | null> {
        return await this.dirBatchMap.getValue(key);
    }

    async deleteBatchDir(key: string): Promise<void> {
        await this.dirBatchMap.deleteValue(key);
    }

    // Retry Batch Methods (for GroupedOperationsBatch storage)
    async setRetryBatch(key: string, value: any): Promise<void> {
        await this.retryBatches.setValue(key, value);
    }

    async getRetryBatch(key: string): Promise<any | null> {
        return await this.retryBatches.getValue(key);
    }

    async deleteRetryBatch(key: string): Promise<void> {
        await this.retryBatches.deleteValue(key);
    }

    /**
     * Gets the current retry cursor.
     * Returns empty string if no cursor has been set.
     */
    async getRetryCursor(): Promise<string> {
        return await this.cursorMap.getValue('retryCursor') || '';
    }

    /**
     * Sets the retry cursor for pagination checkpoint.
     * @param cursor - The cursor value to save
     */
    async setRetryCursor(cursor: string): Promise<void> {
        await this.cursorMap.setValue('retryCursor', cursor);
    }
    
    // In-Process Files ZSET Methods
    async addInProcessFile(fPath: string, size: number | null): Promise<void> {}
    async removeInProcessFile(fPath: string, size: number | null): Promise<void> {}

    serialize(): string {
        const data = {
            jobRunId: this.jobRunId,
            jobConfig: this.jobConfig,
            jobRunStatus: this.jobRunStatus,
        }
        return JSON.stringify(data);
    }

    deserialize(json: string) {
        return JSON.parse(json);
    }

    // Directory Content Set Methods (for streaming large directories)
    async addToDirContentSet(key: string, members: string[]): Promise<void> {
        throw new Error(
            "DirContentSet operations are not supported on base JobManagerContext. Override addToDirContentSet in a subclass.",
        );
    }
    async areDirContentMembers(key: string, members: string[]): Promise<boolean[]> { return members.map(() => false); }
    async scanDirContentSet(key: string, cursor: number, count: number): Promise<{cursor: number, members: string[]}> { return {cursor: 0, members: []}; }
    async deleteDirContentSet(key: string): Promise<void> {}

    async initializeInstance(): Promise<void>{ }

    async cleanup(): Promise<void> {}
}