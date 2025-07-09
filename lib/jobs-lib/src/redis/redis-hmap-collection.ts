// create a hset collection

import { RedisClientType } from "redis";
import { Serializable } from "src/types/serializable";
import { WorkerRunningTaskMapCollection } from "./hmap-collection";
import { encode, decode } from 'msgpack-lite';

export class RedisHMapCollection<T extends Serializable> implements WorkerRunningTaskMapCollection<T> {
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
        await this.redisClient.hSet(this.redisMapKey, key, this.encodeValue(value));
    }

    async setValueIfNotExists(key: string, value: T): Promise<boolean> {
        const result = await this.redisClient.hSetNX(this.redisMapKey, key, this.encodeValue(value));
        return result;
    }

    async getAll(): Promise<any> {
        const encodedData =  await this.redisClient.hGetAll(this.redisMapKey);
        if(encodedData === null || Object.keys(encodedData).length === 0)  return {};
        const result = {};
        for (const [key, value] of Object.entries(encodedData)) {
            result[key] = this.decodeValue(value);
        }
        return result;
    }

    async getValue(key: string): Promise<T | null> {
        const base64Data = await this.redisClient.hGet(this.redisMapKey, key);
        if(!base64Data ) return null; 
        const packed = Buffer.from(base64Data, 'base64'); // Ensure the value is a Buffer
        const value = decode(packed);
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
        return { key: firstKey, value: value };
    }

    async assignToSelf(key: string): Promise<T | null> {
        const existingValue = await this.getOneValue();
        if (!existingValue) return null;
        await this.redisClient.hSet(this.redisMapKey, key, this.encodeValue(existingValue.value));        
        await this.deleteValue(existingValue.key);
        return existingValue.value;
    }

    async isEmpty(): Promise<boolean> {
        return await this.redisClient.hLen(this.redisMapKey) === 0;
    }

    async getSize(): Promise<number> {
        const allValues = await this.getAll();
        if (!allValues) return 0;
        return Object.keys(allValues).length;
    }


    encodeValue(value: T): string {
        const packed = encode(value);
        return packed.toString('base64'); 
    }


    decodeValue(value: string): T | null {
        if (!value) return null;
        const packed = Buffer.from(value, 'base64'); 
        const decoded = decode(packed);
        return decoded ? JSON.parse(decoded) : null;
    }

    
}