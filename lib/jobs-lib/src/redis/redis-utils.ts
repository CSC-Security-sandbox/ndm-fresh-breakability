import { createClient, RedisClientType } from 'redis';
import { createPool, Pool } from 'generic-pool';


interface PoolOptions {
  minConnections?: number;
  maxConnections?: number;
  acquireTimeout?: number;
  idleTimeout?: number;
}

export class RedisUtils {
private pool: Pool<RedisClientType['v4']> | null = null;
  private poolOptions: Required<PoolOptions>;

  constructor(options?: PoolOptions) {
    this.poolOptions = {
      minConnections: 5,
      maxConnections: 20,
      acquireTimeout: 5000,
      idleTimeout: 30000,
      ...options
    };
  }

  async initializePool(): Promise<void> {
    if (this.pool) {
      return;
    }

    const factory = {
      create: async (): Promise<RedisClientType> => {
        return await this.createClient();
      },
      destroy: async (client: RedisClientType): Promise<void> => {
        try {
          if (client.isOpen) {
            await client.quit();
          }
        } catch (error) {
          console.error('Error destroying Redis client:', error);
        }
      },
      validate: async (client: RedisClientType): Promise<boolean> => {
        return client.isOpen;
      }
    };

    this.pool = createPool(factory, {
      min: this.poolOptions.minConnections,
      max: this.poolOptions.maxConnections,
      acquireTimeoutMillis: this.poolOptions.acquireTimeout,
      idleTimeoutMillis: this.poolOptions.idleTimeout,
      testOnBorrow: true,
      evictionRunIntervalMillis: 10000,
      numTestsPerEvictionRun: 3
    });

    // Pre-create minimum connections
    const promises = [];
    for (let i = 0; i < this.poolOptions.minConnections; i++) {
      promises.push(
        this.pool.acquire()
          .then(client => this.pool!.release(client))
          .catch(error => {
            console.error(`Failed to acquire and release Redis client during pool initialization: ${error}`);
          })
      );
    }
    await Promise.all(promises);

    console.log(`Redis pool initialized with min ${this.poolOptions.minConnections} connections`);
  }

 async getClient(): Promise<RedisClientType['v4']> {
  if (!this.pool) {
    await this.initializePool();
  }
  return this.pool.acquire();
}

  async releaseClient(client: RedisClientType['v4']): Promise<void> {
    if (!this.pool) {
      console.warn('Pool not initialized');
      return;
    }
    await this.pool.release(client);
  }


  private async createClient(): Promise<RedisClientType> {
    const redisClientOptions = {
      url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            console.error('Redis connection failed after 10 retries');
            return false;
          }
          return Math.min(retries * 100, 3000);
        },
      },
    };

    if (process.env.REDIS_USERNAME && process.env.REDIS_PASSWORD) {
      redisClientOptions['username'] = process.env.REDIS_USERNAME;
      redisClientOptions['password'] = process.env.REDIS_PASSWORD;
    }

    const client = createClient(redisClientOptions) as RedisClientType;
    
    client.on('error', (error) => {
      console.error(`Redis connection error: ${error}`);
    });

    client.on('connect', () => {
     console.info('Redis client connected');
    });

    client.on('ready', () => {
      console.info('Redis client ready');
    });

    await client.connect();
    return client;
  }

  async closePool(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.drain();
    await this.pool.clear();
    this.pool = null;
    console.log('Redis pool closed');
  }
}
