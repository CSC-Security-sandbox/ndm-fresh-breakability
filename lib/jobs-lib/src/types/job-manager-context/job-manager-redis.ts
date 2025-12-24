import { RedisClientType } from "redis";
import { RedisCommandCollection, RedisErrorCollection, RedisItemInfoCollection, RedisTaskCollection, RedisTaskInfoCollection } from "../../redis/redis-collections";
import { RedisHMapCollection } from "../../redis/redis-hmap-collection";
import { JobConfig } from "../job-config";
import { JobManagerContext } from "./job-manager-context";


export class RedisJobManagerContext extends JobManagerContext {
    redisClient: RedisClientType;

    constructor(redisClient: RedisClientType, jobRunId: string, jobConfig?: JobConfig, jobRunStatus?: string)  {
        super(jobRunId, jobConfig, jobRunStatus)
        this.redisClient = redisClient;
        this.fileStream = new RedisItemInfoCollection(this.jobRunId, 0, '0-0', this.redisClient);
        this.errorStream = new RedisErrorCollection(this.jobRunId, 0, '0-0', this.redisClient);
        this.commandStream = new RedisCommandCollection(this.jobRunId, 0, '0-0', this.redisClient);
        this.taskStream = new RedisTaskInfoCollection(this.jobRunId, 0, '0-0', this.redisClient);
        this.taskMap = new RedisHMapCollection(this.jobRunId, 'taskMap', this.redisClient);
        this.dirBatchMap = new RedisHMapCollection(this.jobRunId, 'dirBatchMap', this.redisClient);
        this.cursorMap = new RedisHMapCollection(this.jobRunId, 'cursorMap', this.redisClient);
    }

    async initializeInstance(): Promise<void> {
        const jobDetail =  await this.redisClient.get(this.jobRunId);
        if (!jobDetail) return;
        const info  = this.deserialize(jobDetail);
        this.jobConfig = info.jobConfig;
        this.jobRunStatus = info.jobRunStatus;
        this.jobRunId = info.jobRunId;
    }

    async init(): Promise<void> {
        for (const collection of [this.fileStream, this.errorStream, this.commandStream, this.taskStream]) {
            await collection.init();  
        }
        await this.redisClient.set(this.jobRunId, this.serialize());
    }

    async cleanup(): Promise<void> {
        for (const collection of [this.fileStream, this.errorStream, this.commandStream, this.taskStream]) {
            await collection.cleanup();  
        }

        if (await this.redisClient.exists(this.jobRunId)) {
            const keys = await this.redisClient.keys(`${this.jobRunId}*`);
            for (const key of keys) 
                await this.redisClient.del(key);
        }

    }

}