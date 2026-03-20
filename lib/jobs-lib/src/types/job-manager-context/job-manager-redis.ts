import { RedisClientType } from "redis";
import { RedisCommandCollection, RedisErrorCollection, RedisItemInfoCollection, RedisTaskCollection, RedisTaskInfoCollection } from "../../redis/redis-collections";
import { RedisHMapCollection } from "../../redis/redis-hmap-collection";
import { JobConfig } from "../job-config";
import { DEFAULT_DIR_CONTENT_TTL_SECONDS } from "../options";
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
        this.retryBatches = new RedisHMapCollection(this.jobRunId, 'retryBatches', this.redisClient);
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

    // Directory Content Set Methods — bulk Redis Set operations for streaming large directories
    private dirContentSetKey(key: string): string {
        return `${this.jobRunId}:dirContent:${key}`;
    }

    private get dirContentTtlSeconds(): number {
        return this.jobConfig?.options?.dirContentTtlSeconds ?? DEFAULT_DIR_CONTENT_TTL_SECONDS;
    }

    async addToDirContentSet(key: string, members: string[]): Promise<void> {
        if (members.length === 0) return;
        const redisKey = this.dirContentSetKey(key);
        await this.redisClient.sAdd(redisKey, members);
        await this.redisClient.expire(redisKey, this.dirContentTtlSeconds);
    }

    async areDirContentMembers(key: string, members: string[]): Promise<boolean[]> {
        if (members.length === 0) return [];
        const redisKey = this.dirContentSetKey(key);
        const results = await this.redisClient.smIsMember(redisKey, members);
        return results;
    }

    async scanDirContentSet(key: string, cursor: number, count: number): Promise<{cursor: number, members: string[]}> {
        const redisKey = this.dirContentSetKey(key);
        const result = await this.redisClient.sScan(redisKey, cursor, { COUNT: count });
        return { cursor: result.cursor, members: result.members };
    }

    async deleteDirContentSet(key: string): Promise<void> {
        const redisKey = this.dirContentSetKey(key);
        await this.redisClient.del(redisKey);
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