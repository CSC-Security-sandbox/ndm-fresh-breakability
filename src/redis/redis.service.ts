import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { createClient, RedisClientType } from 'redis';


@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  async onModuleInit() {
    this.redisClient = await RedisUtils.getClient();
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
      this.logger.log(`[Job-Service] Connected to Redis`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
      this.logger.log(`[Job-Service] Redis client disconnected`);
    }
  }
  async getJobContext(traceId: string) {
    if (!this.redisClient) {
      this.logger.error('[Job-Service] Redis client is not initialized, trying to reconnect');
      this.redisClient = await this.getClient();
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    const contextProvider = JobContextFactory.getProvider('redis', this.redisClient);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    if (!this.redisClient) {
      this.logger.error('[Job-Service] Redis client is not initialized, trying to reconnect');
      this.redisClient = await this.getClient()
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    const serializedContext = jobContext.serialize(); 
    await this.redisClient.set(traceId, serializedContext);
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
  async getClient(): Promise<RedisClientType> {
    if (!this.redisClient) {
      this.logger.error('[Job-Service] Redis client is not initialized, trying to reconnect');
      this.redisClient = await RedisUtils.getClient();
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    return this.redisClient;
  }
}
