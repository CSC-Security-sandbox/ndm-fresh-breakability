import { JobState } from '../types/job-state';
import { JobContext } from '../types/job-context';
import { JobConfig } from '../types/job-config';
import { RedisClientType } from 'redis';
import {
  RedisDirectoryCollection,
  RedisErrorCollection,
  RedisFileCollection,
  RedisMigrationTasksCollection,
  RedisTaskCollection,
  RedisTaskStatsCollection,
} from './redis-collections';
import { Logger } from '../utils/logging';
import { SpeedTestJobContext } from '../types/speed-test-job-context';
import { SpeedTestJobConfig } from '../types/speed-test-job-config';

export class RedisJobContext extends JobContext {
  redisClient: RedisClientType;
  logger: Logger;

  constructor(
    jobRunId: string,
    redisClient: RedisClientType,
    jobConfig?: JobConfig,
    jobRunStatus?: string,
    jobState?: JobState,
  ) {
    super(jobRunId, jobConfig, jobRunStatus, jobState);
    this.redisClient = redisClient;
    this.logger = Logger.getLogger(jobRunId);

    this.filesInfo = new RedisFileCollection(jobRunId, 0, '0-0', redisClient);
    this.dirsInfo = new RedisDirectoryCollection(jobRunId,0,'0-0',redisClient,);
    this.tasksInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
    this.migrateTask = new RedisMigrationTasksCollection(jobRunId, 0, '0-0', redisClient);
    this.taskStats = new RedisTaskStatsCollection(jobRunId, 0, '0-0', redisClient);
    this.errorsInfo = new RedisErrorCollection(jobRunId, 0, '0-0', redisClient);
    this.updatedTaskInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
  }

  async init(): Promise<void> {
    for (const key of [this.jobRunId, `stats:${this.jobRunId}`]) {
      if (await this.redisClient.exists(key)) {
        this.logger.info(`Cleaning up existing key: ${key}`);
        await this.redisClient.del(key);
      }
    }

    for (const collection of [
      this.filesInfo,
      this.dirsInfo,
      this.errorsInfo,
      this.tasksInfo,
      this.taskStats,
      this.migrateTask,
      this.updatedTaskInfo
    ]) {
        this.logger.info(`Initializing collection: ${collection.streamKey}`);
        await collection.init();  
    }

    await this.redisClient.set(this.jobRunId, this.serialize());
  }

  async close(): Promise<void> {
    const infoJSon = this.serialize();
    await this.redisClient.set(this.jobRunId, infoJSon);

    for (const collection of [this.filesInfo, this.dirsInfo, this.errorsInfo]) {
      if (collection) {
        collection.close();
      }
    }

    for (const [key, value] of this.stats.entries()) {
      await this.redisClient.hIncrBy(`stats:${this.jobRunId}`, key, value);
    }
    this.redisClient.disconnect();
  }

  async cleanup(): Promise<void> {
    if (await this.redisClient.exists(this.jobRunId)) {
      this.logger.info(
        `Cleaning up existing state for Job Run Id: ${this.jobRunId}`,
      );
      await this.redisClient.del(this.jobRunId);
    }

    for (const collection of [this.filesInfo, this.dirsInfo, this.errorsInfo]) {
      await collection.cleanup();
    }

    //do we need this???
    //this.redisClient.disconnect();
  }
}

export class RedisSpeedTestJobContext extends SpeedTestJobContext {
  redisClient: RedisClientType;
  logger: Logger;

  constructor(
    jobRunId: string,
    redisClient: RedisClientType,
    jobConfig?: SpeedTestJobConfig,
    jobRunStatus?: string,
    jobState?: JobState,
  ) {
    super(jobRunId, jobConfig, jobRunStatus, jobState);
    this.redisClient = redisClient;
    this.logger = Logger.getLogger(jobRunId);

    this.filesInfo = new RedisFileCollection(jobRunId, 0, '0-0', redisClient);
    this.dirsInfo = new RedisDirectoryCollection(jobRunId,0,'0-0',redisClient,);
    this.tasksInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
    this.migrateTask = new RedisMigrationTasksCollection(jobRunId, 0, '0-0', redisClient);
    this.taskStats = new RedisTaskStatsCollection(jobRunId, 0, '0-0', redisClient);
    this.errorsInfo = new RedisErrorCollection(jobRunId, 0, '0-0', redisClient);
    this.updatedTaskInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
  }

  async init(): Promise<void> {
    for (const key of [this.jobRunId, `stats:${this.jobRunId}`]) {
      if (await this.redisClient.exists(key)) {
        this.logger.info(`Cleaning up existing key: ${key}`);
        await this.redisClient.del(key);
      }
    }

    for (const collection of [
      this.filesInfo,
      this.dirsInfo,
      this.errorsInfo,
      this.tasksInfo,
      this.taskStats,
      this.migrateTask,
      this.updatedTaskInfo
    ]) {
        this.logger.info(`Initializing collection: ${collection.streamKey}`);
        await collection.init();  
    }

    await this.redisClient.set(this.jobRunId, this.serialize());
  }

  async close(): Promise<void> {
    const infoJSon = this.serialize();
    await this.redisClient.set(this.jobRunId, infoJSon);

    for (const collection of [this.filesInfo, this.dirsInfo, this.errorsInfo]) {
      if (collection) {
        collection.close();
      }
    }

    for (const [key, value] of this.stats.entries()) {
      await this.redisClient.hIncrBy(`stats:${this.jobRunId}`, key, value);
    }
    this.redisClient.disconnect();
  }

  async cleanup(): Promise<void> {
    if (await this.redisClient.exists(this.jobRunId)) {
      this.logger.info(
        `Cleaning up existing state for Job Run Id: ${this.jobRunId}`,
      );
      await this.redisClient.del(this.jobRunId);
    }

    for (const collection of [this.filesInfo, this.dirsInfo, this.errorsInfo]) {
      await collection.cleanup();
    }

    //do we need this???
    //this.redisClient.disconnect();
  }
}
