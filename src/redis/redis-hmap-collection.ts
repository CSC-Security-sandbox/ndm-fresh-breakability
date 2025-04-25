// create a hset collection

import { RedisClientType } from "redis";
import { Serializable } from "src/types/serializable";
import { HMapCollection } from "./hmap-collection";

export class RedisHMapCollection<T extends Serializable> implements HMapCollection<T> {
    jobRunId: string;
    mapType: string;
    redisClient: RedisClientType;
    redisMapKey: string;

    constructor(
        jobRunId: string,
        mapType: string,
        redisClient: RedisClientType,
    ) {
        this.jobRunId = jobRunId;
        this.mapType = mapType;
        this.redisClient = redisClient;
        this.redisMapKey = `${this.jobRunId}:${this.mapType}`;
    }   

    async init(): Promise<void> {}

    async close(): Promise<void> {}

    async cleanup(): Promise<void> {
        await this.redisClient.del(this.redisMapKey);
    }

    async setValue(key: string, value: T): Promise<void> {
        await this.redisClient.hSet(this.redisMapKey, key, JSON.stringify(value));
    }

    async getAll(): Promise<any> {
        return await this.redisClient.hGetAll(this.redisMapKey);
    }

    async getValue(key: string): Promise<T | null> {
        const value = await this.redisClient.hGet(this.redisMapKey, key);
        return value ? JSON.parse(value) : null;
    }

    async deleteValue(key: string): Promise<void> {
        await this.redisClient.hDel(this.redisMapKey, key);
    }

    async deleteAll(): Promise<void> {
        await this.redisClient.del(this.redisMapKey);
    }

    async getOneValue(): Promise<{ key: string, value: T } | null> {
        const allValues = await this.getAll();
        const keys = Object.keys(allValues);
        if (keys.length === 0) return null;
        const firstKey = keys[0];
        const value = allValues[firstKey];
        return { key: firstKey, value: JSON.parse(value) };
    }

    async assignToSelf(key: string): Promise<T | null> {
        const existingEntry = await this.getOneValue();
        if (!existingEntry) return null;
        await this.setValue(key, existingEntry.value);
        await this.deleteValue(existingEntry.key);
        return existingEntry.value;
    }
}