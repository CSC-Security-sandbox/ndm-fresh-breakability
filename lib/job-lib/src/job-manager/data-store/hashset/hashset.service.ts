import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";
import { RedisClientType } from "@redis/client";
import { GroupReaderType } from "../../../constant/enum";
import { encode, decode } from 'msgpack-lite';
import { ConfigService } from "@nestjs/config";
import { RedisOptions } from "../../../config/redis.config.type";


@Injectable()
export class HashSetService {

    readonly readerGroup;

    constructor(
        readonly redisService: RedisService,
         readonly configService: ConfigService
    ) {
        const redisCfg = this.configService.get<RedisOptions>('redisOptions');
        this.readerGroup = redisCfg.readerGroup || GroupReaderType.WORKER;
    }

    async setValue(jobRunId: string, hashName: string, key: string, value: any): Promise<void> {
        const redisClient: RedisClientType = await this.redisService.getClient();
        const hashKey = `${jobRunId}:${hashName}-map`;
        await redisClient.hSet(hashKey, key, JSON.stringify(value));
    }

    async setValueIfNotExists(jobRunId: string, hashName: string, key: string, value: any) {
        const redisClient: RedisClientType = await this.redisService.getClient();
        const hashKey = `${jobRunId}:${hashName}-map`;
        const result = await redisClient.hSetNX(hashKey, key, JSON.stringify(value));
        return result;
    }

    async getValue(jobRunId: string, hashName: string, key: string): Promise<any | null> {
        const redisClient: RedisClientType = await this.redisService.getClient();
        const hashKey = `${jobRunId}:${hashName}-map`;
        const val  = await redisClient.hGet(hashKey, key) as string | null;
        return val ? JSON.parse(val) : null;
    }

    async deleteValue(jobRunId: string, hashName: string, key: string): Promise<void> {
        const redisClient: RedisClientType = await this.redisService.getClient();
        const hashKey = `${jobRunId}:${hashName}-map`;
        await redisClient.hDel(hashKey, key);
    }

    async deleteAll(jobRunId: string, hashName: string): Promise<void> {
        const redisClient: RedisClientType = await this.redisService.getClient();
        const hashKey = `${jobRunId}:${hashName}-map`;
        await redisClient.del(hashKey);
    }

}