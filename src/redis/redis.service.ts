import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisUtils, JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';

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

  async onModuleDestroy() {
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
      console.log('Redis connection closed');
    }
  }
}
