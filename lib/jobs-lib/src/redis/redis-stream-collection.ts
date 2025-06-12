import { Serializable } from '../types/serializable';
import { StreamCollection } from '../types/stream-collection';
import { RedisClientType } from 'redis';
import { encode, decode } from 'msgpack-lite';
import { GroupReaderType } from '../types/enums';


export class RedisStreamCollection<T extends Serializable>
  implements StreamCollection<T>
{
  redisClient: RedisClientType;
  jobRunId: string;
  streamKey: string;
  numMessages: number;
  lastId: string;
  consumerGroupCount: number;
  ackCounterKey: string;
  
  constructor(
    jobRunId: string,
    streamKey: string,
    numMessages: number,
    lastId: string,
    redisClient: RedisClientType,
  ) {
    this.jobRunId = jobRunId;
    this.streamKey = streamKey;
    this.numMessages = numMessages;
    this.lastId = lastId;
    this.redisClient = redisClient;
    this.consumerGroupCount = Object.values(GroupReaderType).length;
    this.ackCounterKey = `${this.streamKey}:ackCounter`;
  }

  async init(): Promise<void> {
    if (await this.redisClient.exists(this.streamKey)) {
     return
    }
    for( const groupType of Object.values(GroupReaderType)) {
      await this.redisClient.xGroupCreate(this.streamKey, `${this.jobRunId}-${groupType}`, '0', {
        MKSTREAM: true,
      }).catch(err => {
        if (err.message.includes('BUSYGROUP')) {
          console.warn(`Consumer group ${this.jobRunId} already exists`);
        }
      })
    }
  }

  async cleanup(): Promise<void> {
    try {
      for( const groupType of Object.values(GroupReaderType)) {
      await this.redisClient.xGroupDestroy(this.streamKey, `${this.jobRunId}-${groupType}`);
        console.info(`→ Consumer group ${this.jobRunId}-${groupType} destroyed`);
      }
    } catch (err) {
        console.warn(`! Could not destroy group: ${err.message}`);
    }
    
    await this.redisClient.del(this.streamKey);
    console.info(`→ Stream ${this.streamKey} deleted`);

    await this.redisClient.del(`${this.streamKey}:ackCounter`);
    console.info(`→ Ack‑counter hash deleted`);
  }

  async close(): Promise<void> {
    console.info(`Closing collection ${this.streamKey}`);
  }

  async append(record: T): Promise<string> {
    try {
      const buffer = encode(record);
      const id = await this.redisClient.xAdd(this.streamKey, '*', {
        obj: buffer.toString('base64'),
      });
      this.numMessages++;
      this.lastId = id;
      return id;
    } catch (err) {
      console.error(`Error writing record: ${err}`, err);
      throw err;
    }
  }

  async *read(readerName: string): AsyncGenerator<T> {
    const readerLastReadId = await this.redisClient.get(`${this.jobRunId}-${readerName}`);
    let lastReadId = readerLastReadId || '0';
    while (true) {
      const results = await this.redisClient.xRead(
        [{ key: this.streamKey, id: lastReadId }],
        { COUNT: 1, BLOCK: 500 },
      );
      if (results) {
        for (const result of results) {
          for (const message of result.messages) {
            lastReadId = message.id;
            this.lastId = lastReadId;
            yield decode(Buffer.from(message.message.obj, 'base64'));
          }
        }
      } else {
        await this.redisClient.set(`${this.jobRunId}-${readerName}`, this.lastId);
        break;
      }
    }
  }

  async *groupRead(readerName: string, batchSize: number, groupType: GroupReaderType): AsyncGenerator<T> {  
    const results = await this.redisClient.xReadGroup(
      `${this.jobRunId}-${groupType}`,
      readerName,
      [{ key: this.streamKey, id: '>' }],
      { COUNT: batchSize, BLOCK: 500 }
    );
    
    if (!results) {
      console.info(`>> No messages to read right now`);
      return;
    }

    for (const { messages } of results) {
      for (const { id, message } of messages) {
        const data = decode(Buffer.from(message.obj, 'base64')) as T;
        yield data;
        await this.redisClient.xAck(this.streamKey, `${this.jobRunId}-${groupType}`, id);
        const ackCount = await this.redisClient.hIncrBy(this.ackCounterKey, id, 1);
        if (ackCount >= (this.consumerGroupCount || 2)) { 
          await this.redisClient.xDel(this.streamKey, id);
          await this.redisClient.hDel(this.ackCounterKey, id);
          console.log(`✓ Deleted message ${id} from stream (both consumers ACKed) for ${this.streamKey}`);
        }
      }
    }
  }

  async *groupReadAndWithoutAck(readerName: string, batchSize: number, groupType: GroupReaderType): AsyncGenerator<{ data: T; id: string; }> {
    let results: any;
    results = await this.redisClient.xReadGroup(
      `${this.jobRunId}-${groupType}`,
      readerName,
      [{ key: this.streamKey, id: '>' }],
      { COUNT: batchSize, BLOCK: 500 }
    );
    
    if (!results || results.length === 0) {
      console.debug(`Finding no messages to read, trying xAutoClaim`);
       results = await this.redisClient.xAutoClaim(
        this.streamKey,
        `${this.jobRunId}-${groupType}`,
        readerName,
        50000,
        '0-0',
        { COUNT: batchSize }
      )
      if (!results || results.length === 0) {
        console.info(`>> No messages to read right now`);
        return;
      }

      for (const { id, message } of results.messages) {
        const data = decode(Buffer.from(message.obj, 'base64')) as T;
        yield {data, id};
      }

    }else {
      for (const { messages } of results) {
        for (const { id, message } of messages) {
          const data = decode(Buffer.from(message.obj, 'base64')) as T;
          yield {data, id};
        }
    }
  }

  } 
  
  async *readAndPurge(readerName: string, batchSize: number, groupType: GroupReaderType): AsyncGenerator<T> {
    const results = await this.redisClient.xReadGroup(
      `${this.jobRunId}-${groupType}`,
      readerName,        
      [{ key: this.streamKey, id: '>' }],
      { COUNT: batchSize, BLOCK: 500 }
    );
  
    if (!results) {
      console.info(`>> No messages to purge right now`);
      return;
    }
  
    for (const { messages } of results) {
      for (const { id, message } of messages) {
        const data = decode(Buffer.from(message.obj, 'base64')) as T;
        yield data;
        await this.redisClient.xAck(this.streamKey, `${this.jobRunId}-${groupType}`, id);
        await this.redisClient.xDel(this.streamKey, id);
        await this.redisClient.hDel(`${this.streamKey}:ackCounter`, id);
      }
    }
  }

  async getLength(): Promise<number> {
    try{
      return this.redisClient.xLen(this.streamKey);
    } catch (err) {
      console.error(`Error getting length of stream: ${err}`, err);
      return -1;
    }
  }

  async batchAck(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      const ackCount = await this.redisClient.hIncrBy(this.ackCounterKey, id, 1);
      if (ackCount >= (this.consumerGroupCount || 2)) { 
        await this.redisClient.xDel(this.streamKey, id);
        await this.redisClient.hDel(this.ackCounterKey, id);
        console.log(`✓ Deleted message ${id} from stream (both consumers ACKed) for ${this.streamKey}`);
      }
    }
    return true;
  }

}
