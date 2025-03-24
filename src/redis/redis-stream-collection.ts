import { Serializable } from '../types/serializable';
import { StreamCollection } from '../types/stream-collection';
import { RedisClientType } from 'redis';
import { encode, decode } from 'msgpack-lite';


export class RedisStreamCollection<T extends Serializable>
  implements StreamCollection<T>
{
  redisClient: RedisClientType;
  jobRunId: string;
  streamKey: string;
  numMessages: number;
  lastId: string;

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
  }

  async init(): Promise<void> {
    if (await this.redisClient.exists(this.streamKey)) {
      await this.cleanup();
    }

    await this.redisClient.xGroupCreate(this.streamKey, this.jobRunId, '0', {
      MKSTREAM: true,
    }).catch(err => {
      if (err.message.includes('BUSYGROUP')) {
        console.warn(`Consumer group ${this.jobRunId} already exists`);
      } else {
        throw err;
      }
    })
   
    this.numMessages = 0;
    this.lastId = '0-0';
  }

  async cleanup(): Promise<void> {
    console.info(`Cleaning up stream ${this.streamKey}`);
    await this.redisClient.del(this.streamKey);
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
    // console.info(`Reader last read id: ${readerLastReadId}`);
    let lastReadId = readerLastReadId || '0';
    //let numMessagesRead = 0;
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
            // console.info(`>> Reading message: ${lastReadId}`);
            //numMessagesRead++;
            yield decode(Buffer.from(message.message.obj, 'base64'));
          }
        }
      } else {
        await this.redisClient.set(`${this.jobRunId}-${readerName}`, this.lastId);
        break;
      }
    }
  }

  async *groupRead(readerName: string, batchSize: number): AsyncGenerator<T> {
    // console.info(
    //   `Reading stream: ${this.streamKey}, ${this.jobRunId}, ${readerName}, Batch Size: ${batchSize}`,
    // );
  
    let lastReadId = '0';
    let messagesProcessed = 0;
  
    while (true) {
      const results = await this.redisClient.xReadGroup(
        this.jobRunId,
        readerName,
        [{ key: this.streamKey, id: '>' }],
        { COUNT: 1, BLOCK: 500 },
      );
  
      if (results) {
        for (const result of results) {
          for (const message of result.messages) {
            lastReadId = message.id;
            this.lastId = lastReadId;
            // console.info(`>> Reading message: ${lastReadId}`);
            yield decode(Buffer.from(message.message.obj, 'base64'));
            messagesProcessed++;
          }
        }
        if (messagesProcessed >= batchSize) {
          console.info(`>> Batch size met (${messagesProcessed} messages). Acknowledging and exiting.`);
          await this.redisClient.xAck(this.streamKey, this.jobRunId, lastReadId);
          break;
        }
      }else{
        console.info(`>> No results, thus exiting`);
        await this.redisClient.xAck(this.streamKey, this.jobRunId, lastReadId);
        break;
      }
  
     
  
      // console.info('>> No results');
      // const groupInfo = await this.redisClient.xInfoGroups(this.streamKey);
      // console.info(`Group info: ${JSON.stringify(groupInfo)}`);
  
      // const consumerGroupInfo = groupInfo.find(
      //   (group) => group.name === this.jobRunId,
      // );
  
      // if (consumerGroupInfo) {
      //   console.info(
      //     `Consumer group ${this.jobRunId} has last delivered ${consumerGroupInfo.lastDeliveredId}`,
      //   );
      //   console.info(`Last collection id : ${this.lastId}`);
  
      //   if (consumerGroupInfo.lastDeliveredId === this.lastId) {
      //     console.info(`>> Acking messages: ${lastReadId}`);
      //     await this.redisClient.xAck(this.streamKey, this.jobRunId, lastReadId);
      //     break;
      //   }
      // } else {
      //   console.info(`Consumer group ${this.jobRunId} not found.`);
      // }
    }
  }
}
