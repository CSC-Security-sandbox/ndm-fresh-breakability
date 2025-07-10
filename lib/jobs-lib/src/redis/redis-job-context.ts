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
  RedisSpeedTestReadWriteCollection,
  RedisUpdatedTasksCollection
} from './redis-collections';
import { SpeedTestJobContext } from '../types/speed-test-job-context';
import { SpeedTestJobConfig } from '../types/speed-test-job-config';
import { RedisHMapCollection } from './redis-hmap-collection';


export class RedisJobContext extends JobContext {
  redisClient: RedisClientType;

  constructor(
    jobRunId: string,
    redisClient: RedisClientType,
    jobConfig?: JobConfig,
    jobRunStatus?: string,
    jobState?: JobState,
  ) {
    super(jobRunId, jobConfig, jobRunStatus, jobState);
    this.redisClient = redisClient;

    this.filesInfo = new RedisFileCollection(jobRunId, 0, '0-0', redisClient);
    this.dirsInfo = new RedisDirectoryCollection(jobRunId,0,'0-0',redisClient,);
    this.tasksInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
    this.migrateTask = new RedisMigrationTasksCollection(jobRunId, 0, '0-0', redisClient);
    this.taskStats = new RedisTaskStatsCollection(jobRunId, 0, '0-0', redisClient);
    this.errorsInfo = new RedisErrorCollection(jobRunId, 0, '0-0', redisClient);
    this.runningSyncTask = new RedisHMapCollection(jobRunId, 'runningSyncTask', redisClient);
    this.runningScanTask = new RedisHMapCollection(jobRunId, 'runningScanTask', redisClient);
    this.updatedTaskInfo = new RedisUpdatedTasksCollection(jobRunId, 0, '0-0', redisClient);
  }

  async init(): Promise<void> {
    for (const key of [this.jobRunId, `stats:${this.jobRunId}`]) {
      if (await this.redisClient.exists(key)) {
        console.log(`Cleaning up existing key: ${key}`);
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
      const keys = await this.redisClient.keys(`${this.jobRunId}*`);
      console.log(`Cleaning up existing keys for: ${this.jobRunId} | keys : ${keys}`);
      for (const key of keys) await this.redisClient.del(key);
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

  constructor(
    jobRunId: string,
    redisClient: RedisClientType,
    jobConfig?: SpeedTestJobConfig,
    jobRunStatus?: string,
    jobState?: JobState,
  ) {
    super(jobRunId, jobConfig, jobRunStatus, jobState);
    this.redisClient = redisClient;

    this.filesInfo = new RedisFileCollection(jobRunId, 0, '0-0', redisClient);
    this.dirsInfo = new RedisDirectoryCollection(jobRunId,0,'0-0',redisClient,);
    this.tasksInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
    this.migrateTask = new RedisMigrationTasksCollection(jobRunId, 0, '0-0', redisClient);
    this.speedTestReadWritesData = new RedisSpeedTestReadWriteCollection(jobRunId, 0, '0-0', redisClient);
    this.taskStats = new RedisTaskStatsCollection(jobRunId, 0, '0-0', redisClient);
    this.errorsInfo = new RedisErrorCollection(jobRunId, 0, '0-0', redisClient);
    this.updatedTaskInfo = new RedisTaskCollection(jobRunId, 0, '0-0', redisClient);
  }

  async init(): Promise<void> {
    for (const key of [this.jobRunId, `stats:${this.jobRunId}`]) {
      if (await this.redisClient.exists(key)) {
        console.log(`Cleaning up existing key: ${key}`);
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
        console.log(`Initializing collection: ${collection.streamKey}`);
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
      console.log(
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
