import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { RedisOptions } from '../config/redis.config.type';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);
  readonly redisClientOption;

  constructor(private readonly configService: ConfigService) {
    const redisCfg = this.configService.get<RedisOptions>('redisOptions');
    this.redisClientOption = {
      url : `redis://${redisCfg.redisHost}:${redisCfg.redisPort}`
    }

    if(redisCfg.redisUsername && redisCfg.redisPassword) {
      this.redisClientOption.username = redisCfg.redisUsername;
      this.redisClientOption.password = redisCfg.redisPassword;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.createClient();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client && this.client.isOpen) {
      await this.client.quit();
      this.logger.log('Redis client disconnected');
    }
  }

  async createClient(): Promise<void> {
    if (this.client && this.client.isOpen) {
      return;
    }
  
    const redisClientOptions = this.redisClientOption;
    this.client = createClient(redisClientOptions);

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis');
    });

    await this.client.connect();
  }

  private async ensureClient(): Promise<void> {
    if (!this.client || !this.client.isOpen) {
      this.logger.warn('Redis client not initialized. Attempting to reconnect...');
      await this.createClient();
    }
  }

  getClient(): RedisClientType {
    if (!this.client || !this.client.isOpen) {
      throw new Error('Redis client is not initialized yet.');
    }
    return this.client;
  }

}
