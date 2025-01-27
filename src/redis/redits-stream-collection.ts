import { Serializable } from '../types/serializable';
import { StreamCollection } from '../types/stream-collection';
import { RedisClientType } from 'redis';
import { encode, decode } from 'msgpack-lite';
import { Logger } from '../utils/logging';

export class RedisStreamCollection<T extends Serializable>
  implements StreamCollection<T>
{
  redisClient: RedisClientType;
  jobRunId: string;
  streamKey: string;
  numMessages: number;
  lastId: string;
  logger: Logger;

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
    this.logger = Logger.getLogger(jobRunId);
  }

  async init(): Promise<void> {
    if (await this.redisClient.exists(this.streamKey)) {
      await this.cleanup();
    }

    if (
      await this.redisClient.xGroupCreate(this.streamKey, this.jobRunId, '0', {
        MKSTREAM: true,
      }).catch(err => {
        if (err.message.includes('BUSYGROUP')) {
          this.logger.warn(`Consumer group ${this.jobRunId} already exists`);
        } else {
          throw err;
        }
      })
    ) {
      this.logger.info(
        `Consumer group ${this.jobRunId} created for stream : ${this.streamKey}`,
      );
    }

    this.numMessages = 0;
    this.lastId = '0-0';
  }

  async cleanup(): Promise<void> {
    this.logger.info(`Cleaning up stream ${this.streamKey}`);
    await this.redisClient.del(this.streamKey);
  }

  async close(): Promise<void> {
    this.logger.info(`Closing collection ${this.streamKey}`);
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
      this.logger.error(`Error writing record: ${err}`, err);
      throw err;
    }
  }

  async *read(readerName: string): AsyncGenerator<T> {
    this.logger.info(
      `Reading stream: ${this.streamKey}, ${this.jobRunId}, ${readerName}`,
    );

    let lastReadId = '0';
    //let numMessagesRead = 0;
    while (true) {
      const results = await this.redisClient.xRead(
        [{ key: this.streamKey, id: this.lastId }],
        { COUNT: 1, BLOCK: 5000 },
      );
      if (results) {
        for (const result of results) {
          for (const message of result.messages) {
            lastReadId = message.id;
            this.lastId = lastReadId;
            this.logger.info(`>> Reading message: ${lastReadId}`);
            //numMessagesRead++;
            yield decode(Buffer.from(message.message.obj, 'base64'));
          }
        }
      } else {
        break;
      }
    }
  }

  async *groupRead(readerName: string): AsyncGenerator<T> {
    this.logger.info(
      `Reading stream: ${this.streamKey}, ${this.jobRunId}, ${readerName}`,
    );

    let lastReadId = '0';
    while (true) {
      const results = await this.redisClient.xReadGroup(
        this.jobRunId,
        readerName,
        [{ key: this.streamKey, id: '>' }],
        { COUNT: 1, BLOCK: 5000 },
      );
      if (results) {
        for (const result of results) {
          for (const message of result.messages) {
            lastReadId = message.id;
            this.lastId = lastReadId;
            this.logger.info(`>> Reading message: ${lastReadId}`);
            yield decode(Buffer.from(message.message.obj, 'base64'));
          }
        }
      } else {
        this.logger.info('>> No results');
        const groupInfo = await this.redisClient.xInfoGroups(this.streamKey);
        this.logger.info(`Group info: ${JSON.stringify(groupInfo)}`);

        const consumerGroupInfo = groupInfo.find(
          (group) => group.name === this.jobRunId,
        );
        if (consumerGroupInfo) {
          this.logger.info(
            `Consumer group ${this.jobRunId} has last delivered ${consumerGroupInfo.lastDeliveredId}`,
          );
          this.logger.info(`Last collection id : ${this.lastId}`);

          if (consumerGroupInfo.lastDeliveredId == this.lastId) {
            this.logger.info(`>> Acking messages: ${lastReadId}`);
            await this.redisClient.xAck(
              this.streamKey,
              this.jobRunId,
              lastReadId,
            );
            break;
          }
        } else {
          this.logger.info(`Consumer group ${this.jobRunId} not found.`);
        }
      }
    }
  }
}
