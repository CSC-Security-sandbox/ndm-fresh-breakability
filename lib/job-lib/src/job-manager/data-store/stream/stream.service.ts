import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";
import { RedisClientType } from "@redis/client";
import { GroupReaderType } from "../../../constant/enum";
import { StreamRecord } from "./stream.type";
import { encode, decode } from 'msgpack-lite';
import { ConfigService } from "@nestjs/config";
import { RedisOptions } from "../../../config/redis.config.type";


@Injectable()
export class StreamService {

   readonly readerGroup;
   
    constructor(
        readonly redisService: RedisService,
        readonly configService: ConfigService
    ) {
           const redisCfg = this.configService.get<RedisOptions>('redisOptions');
           this.readerGroup = redisCfg.readerGroup || GroupReaderType.WORKER;
    }

    async init(jobRunId: string, streamName: string): Promise<void> {
        const redisClient:RedisClientType = await this.redisService.getClient();
        const streamKey = `${jobRunId}:${streamName}`;
        for( const groupType of Object.values(GroupReaderType)) {
            await redisClient.xGroupCreate(streamKey, `${jobRunId}-${groupType}`, '0', { MKSTREAM: true})
            .catch(err => {
            if (err.message.includes('BUSYGROUP')) 
                console.warn(`Consumer group ${jobRunId} already exists`);
            else 
                console.error(`Error creating consumer group ${jobRunId}-${groupType}:`, err);
            })
        }        
    }

    async cleanup(jobRunId: string, streamName: string): Promise<void> {
        const redisClient:RedisClientType = await this.redisService.getClient();
        const streamKey = `${jobRunId}:${streamName}`;
        try {
            for( const groupType of Object.values(GroupReaderType)) {
                await redisClient.xGroupDestroy(streamKey, `${jobRunId}-${groupType}`);
                console.info(`→ Consumer group ${jobRunId}-${groupType} destroyed`);
            }
        } catch (err) {
            console.warn(`! Could not destroy group: ${err}`);
        }
        await redisClient.del(streamKey);
        console.info(`→ Stream ${streamKey} deleted`);
    }

    async appendToStream(jobRunId: string, streamName: string, record: StreamRecord) : Promise<string> {
        const redisClient:RedisClientType = await this.redisService.getClient();
        const streamKey = `${jobRunId}:${streamName}`;
        const buffer = encode(record);
        const result = await redisClient.xAdd(streamKey, '*', { obj: buffer.toString('base64') });
        return result;
    }

    async *groupReadWithoutAck(jobRunId: string, streamName: string, batchSize: number): AsyncGenerator<{ data: StreamRecord; id: string; }> {
        const redisClient:RedisClientType = await this.redisService.getClient();
        const streamKey = `${jobRunId}:${streamName}`;
        let results: any = await redisClient.xReadGroup( `${jobRunId}-${this.readerGroup}`, jobRunId,
            [{ key: streamKey, id: '>' }],
            { COUNT: batchSize, BLOCK: 500 }
            );
        if(!results || results.length === 0) {
            console.warn(`Finding no messages to read, trying xAutoClaim`);
            results = await redisClient.xAutoClaim(
                streamKey, `${jobRunId}-${this.readerGroup}`,
                jobRunId, 50000,'0-0',
                { COUNT: batchSize }
            )
            if (!results || results.length === 0) {
                console.info(`>> No messages to read right now`);
                return;
            }
            for (const { id, message } of results.messages) {
                const data = decode(Buffer.from(message.obj, 'base64')) ;
                yield {data, id};
            }
        }else {
            for (const { messages } of results) {
                for (const { id, message } of messages) {
                    const data = decode(Buffer.from(message.obj, 'base64')) ;
                    yield {data, id};
                }
            }
        }
    }

    async ackAndPurge(jobRunId: string, streamName: string, ids: string[]): Promise<boolean> {
        const redisClient:RedisClientType = await this.redisService.getClient();
        const multi = redisClient.multi();
        const streamKey = `${jobRunId}:${streamName}`;
        for (const id of ids) {
            multi.xAck(streamKey, `${jobRunId}-${this.readerGroup}`, id);
            multi.xDel(streamKey, id);
        }
        try {
            const result = await multi.exec();
            return Array.isArray(result) && result.every(res => res !== null);
        } catch (error) {
            console.error('Redis multi.exec error:', error);
            return false;
        }
    }

}