import { TaskMap } from "src/redis/hmap-collection";
import { JobConfig } from "../job-config";
import { CommandCollection, ErrorCollection, FileCollection, TaskCollection } from "../stream-collection";
import { Command, DMError, FileInfo, Task } from "../metadata-types";
import { GroupReaderType } from "../enums";




export class JobManagerContext {
    jobRunId: string;
    jobConfig: JobConfig;
    jobRunStatus: string;
    fileStream: FileCollection;
    errorStream: ErrorCollection;
    commandStream: CommandCollection;
    taskStream: TaskCollection;
    taskMap: TaskMap;

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
    async publishToFileStream(file: FileInfo): Promise<string> {
        return await this.fileStream.append(file);
    }

    async *groupReadFileStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: FileInfo; id: string; }> {
        yield* this.fileStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }

    async groupAckFileStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.fileStream.ackAndPurge(ids, groupType);
    }

    // Error Stream Methods
    async publishToErrorStream(error: DMError): Promise<string> {
        return await this.errorStream.append(error);
    }

    async *groupReadErrorStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: DMError; id: string; }> {
        yield* this.errorStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }
    
    async groupAckErrorStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.errorStream.ackAndPurge(ids, groupType);
    }

    // Command Stream Methods
    async publishToCommandStream(command: Command): Promise<string> {
        return await this.commandStream.append(command);
    }

    async *groupReadCommandStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: Command; id: string; }> {
        yield* this.commandStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }

    async groupAckCommandStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.commandStream.ackAndPurge(ids, groupType);
    }

    // Task Stream Methods
    async publishToTaskStream(task: Task): Promise<string> {
        return await this.taskStream.append(task);
    }
    async *groupReadTaskStream(readerName: string, batchSize:number, groupType: GroupReaderType): AsyncGenerator<{ data: Task; id: string; }> {
        yield* this.taskStream.groupReadWithoutAck(readerName, batchSize, groupType);
    }
    async groupAckTaskStream(ids:string[], groupType: GroupReaderType): Promise<void> {
        await this.taskStream.ackAndPurge(ids, groupType);
    }


    // Task Map Methods
    async setTask(key: string, value: Task): Promise<void> {
        await this.taskMap.setValue(key, value);
    }

    async getTask(key: string): Promise<Task | null> {
        return await this.taskMap.getValue(key);
    }

    async deleteTask(key: string): Promise<void> {
        await this.taskMap.deleteValue(key);
    }
    
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

}