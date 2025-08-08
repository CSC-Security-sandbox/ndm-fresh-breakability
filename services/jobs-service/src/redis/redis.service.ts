import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

import { RedisClientType } from 'redis';

@Injectable()
export class RedisService  implements OnModuleInit, OnModuleDestroy {

  private client: RedisClientType;
  private redisUtils: RedisUtils;
  private logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(RedisService.name);
  }

  constructor() {
    this.redisUtils = new RedisUtils();
  }

  async onModuleInit(): Promise<void> {
    this.client = await this.redisUtils.getClient() as RedisClientType;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisUtils.closePool();
  }

  async getJobContext(traceId: string) {
    const contextProvider = JobContextFactory.getProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async getJobManagerContext(traceId: string) {
    const contextProvider = JobContextFactory.getJobManagerProvider('redis', this.client);
    return await contextProvider.getContext(traceId);
  }

  async getSpeedTestJobContext(traceId: string) {
    const contextProvider = JobContextFactory.getSpeedTestProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    const serializedContext = jobContext.serialize();
    await this.client.set(traceId, serializedContext);
  }

  async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      this.client = await this.redisUtils.getClient() as RedisClientType;
    }
    return this.client;
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
}
