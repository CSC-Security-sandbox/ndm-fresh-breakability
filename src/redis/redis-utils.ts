import { createClient, RedisClientType } from 'redis';
import { Logger } from '../utils/logging';

const logger = Logger.getLogger('redis-utils');

export class RedisUtils {
  static client: RedisClientType;

  static async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      await this.createClient();
    }

    return this.client;
  }

  static async createClient(): Promise<void> {
    const redisClientOptions = {
      url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
    };

    if (process.env.REDIS_USERNAME && process.env.REDIS_PASSWORD) {
      redisClientOptions['username'] = process.env.REDIS_USERNAME;
      redisClientOptions['password'] = process.env.REDIS_PASSWORD;
    }

    logger.info(`Connecting to Redis at ${redisClientOptions.url}`);
    this.client = createClient(redisClientOptions);
    this.client = await this.client.connect();
    this.client.on('error', (error) => {
      logger.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
    });
  }
}
