import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobContext, JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { createClient, RedisClientType } from 'redis';


@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

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

  async getJobContext(traceId: string) {
    await this.ensureClient();
    const contextProvider = JobContextFactory.getProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    await this.ensureClient();
    const serializedContext = jobContext.serialize();
    await this.client.set(traceId, serializedContext);
    this.logger.log(`[${traceId}] Job context saved to Redis.`);
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

  async getOwnerIdentity(jobContext: JobContext, id: string, type: 'SID' | 'UID' | 'GID') {
    return this.client.hGet(`${jobContext.jobRunId}:mapping`, `${type}:${id}`)
    // return "S-1-5-21-3999091835-2882602610-3139272401-1001"
  }
}
