import { createClient, RedisClientType } from 'redis';
import { Logger } from '../utils/logging';

const logger = Logger.getLogger('redis-utils');

export class RedisUtils {
  static client: RedisClientType;
  private static isConnected = false;
  private static readonly maxRetries = 5;
  private static retryCount = 0;
  private static retryTimeout: NodeJS.Timeout | null = null;

  static async getClient(): Promise<RedisClientType> {
    if (!this.isConnected) {
      logger.warn('Redis client is not connected. Attempting to reconnect...');
      await this.createClient();
    }
    return this.client;
  }

  static async createClient(): Promise<void> {
    if (this.client && this.isConnected) return;

    const redisClientOptions: any = {
      url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > this.maxRetries) {
            logger.error('Max Redis reconnect attempts reached.');
            return false;
          }
          const delay = Math.min(1000 * retries, 5000);
          logger.warn(
            `Redis reconnecting... attempt ${retries}, retrying in ${delay}ms`,
          );
          return delay;
        },
      },
    };

    if (process.env.REDIS_USERNAME && process.env.REDIS_PASSWORD) {
      redisClientOptions['username'] = process.env.REDIS_USERNAME;
      redisClientOptions['password'] = process.env.REDIS_PASSWORD;
    }

    this.client = createClient(redisClientOptions);

    this.client.on('error', (error) => {
      logger.error(`Redis error: ${error.message}`);
      this.isConnected = false;
      if (this.retryCount < this.maxRetries) {
        const delay = Math.min(1000 * this.retryCount, 5000); 
        logger.warn(`Retrying connection in ${delay}ms...`);
        this.retryTimeout = setTimeout(async () => {
          this.retryCount++;
          await this.createClient();
        }, delay);
      } else {
        logger.error('Max retry attempts reached. Redis connection failed.');
      }
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
      this.isConnected = true;
      this.retryCount = 0;
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
      }
    });

    this.client.on('reconnecting', () => {
      this.retryCount++;
      logger.warn(`Redis reconnect attempt ${this.retryCount}`);
    });

    this.client.on('end', () => {
      logger.warn('Redis connection closed');
      this.isConnected = false;
    });

    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      logger.error(`Failed to connect to Redis: ${error.message}`);
      this.isConnected = false;
    }
  }
  static async closeClient(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        logger.info('Redis connection closed gracefully.');
      } catch (error) {
        logger.error(`Error closing Redis connection: ${error.message}`);
      } finally {
        this.isConnected = false;
      }
    }
  }
  private static async logRedisStats(): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      const info = await this.client.info();
      const clients = (await this.client.sendCommand(['CLIENT', 'LIST'])).toString();

      const connectedClients = clients?.split('\n').length - 1; 
      const usedMemoryMatch = info?.match(/used_memory_human:(\S+)/);
      const opsPerSecMatch = info?.match(/instantaneous_ops_per_sec:(\d+)/);
      const totalCommands = info?.match(/total_commands_processed:(\d+)/);
      const keysCountMatch = info?.match(/db0:keys=(\d+)/);

      logger.info(`
         Redis Stats:
        ------------------------------
        🔹 Active Connections: ${connectedClients}
        🔹 Memory Used: ${usedMemoryMatch ? usedMemoryMatch[1] : 'N/A'}
        🔹 Ops per Sec: ${opsPerSecMatch ? opsPerSecMatch[1] : 'N/A'}
        🔹 Total Commands Processed: ${totalCommands ? totalCommands[1] : 'N/A'}
        🔹 Keys in DB: ${keysCountMatch ? keysCountMatch[1] : 'N/A'}
      `);
    } catch (error) {
      logger.error(`Failed to fetch Redis stats: ${error.message}`);
    }

    setTimeout(() => this.logRedisStats(), 60000);
  }
}
