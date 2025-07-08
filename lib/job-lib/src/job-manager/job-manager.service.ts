import { Injectable } from "@nestjs/common";
import { HashSetService } from "./data-store/hashset/hashset.service";
import { StreamService } from "./data-store/stream/stream.service";
import { HashSets, Streams } from "../constant/enum";
import { JobConfig } from "./data-store/jobconfig/job-config";
import { RedisService } from "../redis/redis.service";



@Injectable()
export class JobManger {

    constructor(
        readonly hashSetService: HashSetService,
        readonly streamService: StreamService,
        readonly redisService: RedisService 
    ) {}

    async init(jobRunId: string, jobConfig: JobConfig): Promise<void> {
        await Promise.all(Object.values(Streams).map(async (streamName: string) => {
            await this.streamService.init(jobRunId, streamName);
        }));
        const redisClient = await this.redisService.getClient();
        await redisClient.set(jobRunId, jobConfig.serialize());
    }


    async cleanup(jobRunId: string): Promise<void> {
        await Promise.all(Object.values(Streams).map(async (streamName: string) => {
            await this.streamService.cleanup(jobRunId, streamName);
        }));
        await this.hashSetService.deleteAll(jobRunId, HashSets.Tasks);  
        const redisClient = await this.redisService.getClient(); 
        if(await redisClient.exists(jobRunId)) {
            const keys = await redisClient.keys(`${jobRunId}*`);
            for (const key of keys) {
                await redisClient.del(key);
            }
        }
    }

    async getJobConfig(jobRunId: string): Promise<JobConfig | null> {
        const redisClient =await this.redisService.getClient();
        const jobConfigData = await redisClient.get(jobRunId);
        if (typeof jobConfigData === "string") {
            return JSON.parse(jobConfigData);
        }
        return null;
    }


    // file stream methods
    async publishToFileStream(jobRunId: string, data: any): Promise<string> {
        return await this.streamService.appendToStream(jobRunId, Streams.FILES,  data );
    }

    async *groupReadFileStream(jobRunId: string, batchSize:number): AsyncGenerator<{ data: any; id: string; }> {
        yield* this.streamService.groupReadWithoutAck(jobRunId, Streams.FILES, batchSize);
    }

    async groupAckFileStream(jobRunId: string, ids:string[]): Promise<void> {
        await this.streamService.ackAndPurge(jobRunId, Streams.FILES, ids);
    }

    // Error Stream Methods
    async publishToErrorStream(jobRunId: string, data: any): Promise<string> {
        return await this.streamService.appendToStream(jobRunId, Streams.ERRORS,  data );
    }

    async *groupReadErrorStream(jobRunId: string, batchSize:number): AsyncGenerator<{ data: any; id: string; }> {
        yield* this.streamService.groupReadWithoutAck(jobRunId, Streams.ERRORS, batchSize);
    }
    
    async groupAckErrorStream(jobRunId: string, ids:string[]): Promise<void> {
        await this.streamService.ackAndPurge(jobRunId, Streams.ERRORS, ids);
    }

    // Command Stream Methods
    async publishToCommandStream(jobRunId: string, data: any): Promise<string> {
        return await this.streamService.appendToStream(jobRunId, Streams.COMMANDS,  data );
    }

    async *groupReadCommandStream(jobRunId: string, batchSize:number): AsyncGenerator<{ data: any; id: string; }> {
        yield* this.streamService.groupReadWithoutAck(jobRunId, Streams.COMMANDS, batchSize);
    }

    async groupAckCommandStream(jobRunId: string, ids:string[]): Promise<void> {
        await this.streamService.ackAndPurge(jobRunId, Streams.COMMANDS, ids);
    }

    // Task Stream Methods
    async publishToTaskStream(jobRunId: string, data: any): Promise<string> {
        return await this.streamService.appendToStream(jobRunId, Streams.TASKS,  data );
    }

    async *groupReadTaskStream(jobRunId: string, batchSize:number): AsyncGenerator<{ data: any; id: string; }> {
        yield* this.streamService.groupReadWithoutAck(jobRunId, Streams.TASKS, batchSize);
    }

    async groupAckTaskStream(jobRunId: string, ids:string[]): Promise<void> {
        await this.streamService.ackAndPurge(jobRunId, Streams.TASKS, ids);
    }


    // Task Map Methods
    async setTask(jobRunId: string, key: string, value: any): Promise<void> {
        await this.hashSetService.setValue(jobRunId, HashSets.Tasks, key, value);
    }

    async setTaskIfNotExists(jobRunId: string, key: string, value: any): Promise<void> {
        await this.hashSetService.setValueIfNotExists(jobRunId, HashSets.Tasks, key, value);
    }

    async getTask(jobRunId: string, key: string): Promise<any> {
        return await this.hashSetService.getValue(jobRunId, HashSets.Tasks, key);
    }

    async deleteTask(jobRunId: string, key: string): Promise<void> {
        await this.hashSetService.deleteValue(jobRunId, HashSets.Tasks, key);
    }

}