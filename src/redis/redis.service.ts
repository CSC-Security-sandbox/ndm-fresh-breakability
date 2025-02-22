import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisUtils, JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient: any;

  async onModuleInit() {
    this.redisClient = await RedisUtils.getClient();
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
      console.log('Connected to Redis');
    }
  }

  async getJobContext(traceId: string) {
    if (!this.redisClient) {
      throw new Error('Redis client is not initialized');
    }

    const contextProvider = JobContextFactory.getProvider('redis', this.redisClient);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    if (!this.redisClient) {
      throw new Error('Redis client is not initialized');
    }

    const serializedContext = jobContext.serialize();
    await this.redisClient.set(traceId, serializedContext);
    console.log(`[${traceId}] Job context saved to Redis.`);
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

  async onModuleDestroy() {
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
      console.log('Redis connection closed');
    }
  }
}
