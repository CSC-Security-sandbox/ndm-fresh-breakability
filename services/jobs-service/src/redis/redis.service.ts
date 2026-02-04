import { Injectable, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { createClient, RedisClientType } from 'redis';
import {
    LoggerFactory,
    LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger: LoggerService;

    constructor(@Inject(LoggerFactory) loggerFactory: LoggerFactory) {
        this.logger = loggerFactory.create(RedisService.name);
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

    const redisClientOptions: any = {
      url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
    };

    if (process.env.REDIS_USERNAME && process.env.REDIS_PASSWORD) {
      redisClientOptions.username = process.env.REDIS_USERNAME;
      redisClientOptions.password = process.env.REDIS_PASSWORD;
    }

    this.logger.log(`Connecting to Redis at ${redisClientOptions.url}`);
    this.client = createClient(redisClientOptions);

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis');
    });

    await this.client.connect();
  }

  async ensureClient(): Promise<void> {
    if (!this.client || !this.client.isOpen) {
      this.logger.warn('Redis client not initialized. Attempting to reconnect...');
      await this.createClient();
    }
  }

  async getClient(): Promise<RedisClientType> {
    if (!this.client || !this.client.isOpen) {
      this.logger.debug('Redis client is not initialized yet. calling ensureClient again');
      await this.ensureClient();
      this.logger.debug('Redis client initialized from ensureClient');
    }
    return this.client;
  }

  async getJobContext(traceId: string) {
    if (!this.client) {
      this.logger.error('[Job-Service] Redis client is not initialized, trying to reconnect');
      this.client = await this.getClient();
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    const contextProvider = JobContextFactory.getProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    if (!this.client) {
      this.logger.error('[Job-Service] Redis client is not initialized, trying to reconnect');
      this.client = await this.getClient()
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    const serializedContext = jobContext.serialize(); 
    await this.client.set(traceId, serializedContext);
    this.logger.log(`[Job-Service] [${traceId}] Job context saved to Redis.`);
  }

  async getJobState(traceId: string): Promise<any> {
    try {
      const jobContext = await this.getJobContext(traceId);
      return await jobContext.getJobState();
    } catch (error) {
      return { message: 'Error while getting the job state : ' + traceId };
    }
  }
  async setJobState(traceId: string, jobState: JobState): Promise<any> {
    try {
      const jobContext = await this.getJobContext(traceId);
      await jobContext.setJobState(jobState);
      const newJobState = await jobContext.getJobState();
      return newJobState;
    } catch (error) {
      return { message: 'Error while updating the job state : ' + traceId };
    }
  }

  async setDirListing(key: string, value: string, ttlSeconds?: number): Promise<void> {
    console.log(key);
    console.log(value);
    const client = await this.getClient();
    if (ttlSeconds) {
      await client.set(key, value, { EX: ttlSeconds });
    } else {
      await client.set(key, value);
    }
  }
  
  async getDirListing(key: string): Promise<string | null> {
    const client = await this.getClient();
    return client.get(key);
  }
  
  async delDirListing(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(key);
  }
}
