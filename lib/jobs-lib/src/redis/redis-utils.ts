import { createClient, RedisClientType } from 'redis';


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

    console.log(`Connecting to Redis at ${redisClientOptions.url}`);
    this.client = createClient(redisClientOptions);
    this.client.on('error', (error) => {
      console.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      console.info('Connected to Redis');
    });
  }
}
