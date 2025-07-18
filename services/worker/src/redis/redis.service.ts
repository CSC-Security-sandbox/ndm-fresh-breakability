import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { RedisClientType } from 'redis';

@Injectable()
export class RedisService  implements OnModuleInit, OnModuleDestroy {

  private client: RedisClientType['v4'];
  private redisUtils: RedisUtils;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    this.redisUtils = new RedisUtils();
  }

  async onModuleInit(): Promise<void> {
    await this.redisUtils.getClient();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisUtils.closePool();
  }

  async getJobContext(traceId: string) {
   // this.client = await this.redisUtils.getClient();
    const contextProvider = JobContextFactory.getProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async getJobManagerContext(traceId: string) {
   // this.client = await this.redisUtils.getClient();
    const contextProvider = JobContextFactory.getJobManagerProvider('redis', this.client);
    return await contextProvider.getContext(traceId);
  }

  async getSpeedTestJobContext(traceId: string) {
   // this.client = await this.redisUtils.getClient();
    const contextProvider = JobContextFactory.getSpeedTestProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
   // this.client = await this.redisUtils.getClient();
    const serializedContext = jobContext.serialize();
    await this.client.set(traceId, serializedContext);
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

  async getOwnerIdentity(jobRunId: string, id: string, type: 'SID' | 'UID' | 'GID') {
    return await this.client.hGet(`${jobRunId}:mapping`, `${type}:${id}`)
  }

  async getMemoryInfo(): Promise<{ used_memory: number; total_system_memory: number }> {
    this.client = await this.redisUtils.getClient();
    const memoryInfo = await this.client.info('memory');
    const parsedInfo = this.parseMemoryStats(memoryInfo);
    return parsedInfo;
  }

  parseMemoryStats(stats: string): { used_memory: number; total_system_memory: number } {
    let usedMemory = 0;
    let totalSystemMemory = 0;
  
    stats.split('\n').forEach((line) => {
      if (line.startsWith('used_memory:')) {
        usedMemory = parseInt(line.split(':')[1], 10);
      } else if (line.startsWith('total_system_memory:')) {
        totalSystemMemory = parseInt(line.split(':')[1], 10);
      }
    });
    return {
      used_memory: usedMemory,
      total_system_memory: totalSystemMemory,
    };
  }
}
