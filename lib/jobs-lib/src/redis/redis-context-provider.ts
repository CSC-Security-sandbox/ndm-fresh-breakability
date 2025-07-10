import { JobContext } from '../types/job-context';
import { JobConfig } from '../types/job-config';
import { RedisClientType } from 'redis';
import { RedisJobContext, RedisSpeedTestJobContext } from './redis-job-context';
import { RedisDirectoryCollection, RedisErrorCollection, RedisFileCollection, RedisMigrationTasksCollection, RedisTaskCollection, RedisTaskStatsCollection, RedisUpdatedTasksCollection, RedisSpeedTestReadWriteCollection } from './redis-collections';
import { JobState } from '../types/job-state';
import { SpeedTestJobConfig } from 'src/types/speed-test-job-config';
import { SpeedTestJobContext } from '../types/speed-test-job-context';
import { SpeedTestJobContextProvider } from '../speed-test-job-context-provider';
import { JobContextProvider } from 'src/job-context-provider';

export class RedisJobContextProvider implements JobContextProvider {

  constructor(private readonly redisClient: RedisClientType) {}

  async buildContext(
    jobRunId: string,
    jobConfig: JobConfig,
    jobStatus: string,
    jobState: JobState,
  ): Promise<JobContext> {
    console.log(`Building job context for job run id: ${jobRunId}`);
    const jobContext = new RedisJobContext(
      jobRunId,
      this.redisClient,
      jobConfig,
      jobStatus,  
      jobState
    );
    await jobContext.init();
    return jobContext;
  }

  async getJobContext(jobRunId: string): Promise<JobContext | null> {
    const jobContext = new RedisJobContext(jobRunId, this.redisClient);
    const value = await this.redisClient.get(jobRunId);

    if (!value) {
      console.warn(`Job context not found for job run id: ${jobRunId}`);
      return null;
    }

    console.log(`Retrieved job context for job run id: ${jobRunId}`);
    let info = value ? jobContext.deserialize(value) : { filesInfo: { numMessages: 0, lastId: '0-0' }, 
                                                    dirsInfo: { numMessages: 0, lastId: '0-0' }, 
                                                    errorsInfo: { numMessages: 0, lastId: '0-0' },
                                                    tasksInfo: { numMessages: 0, lastId: '0-0' },
                                                    migrateTask: { numMessages: 0, lastId: '0-0' },
                                                    taskStats: { numMessages: 0, lastId: '0-0' },
                                                    updatedTaskInfo: { numMessages: 0, lastId: '0-0' } };
    jobContext.jobConfig = info.jobConfig;
    jobContext.jobRunStatus = info.jobRunStatus;
    jobContext.jobState = info.jobState;
    jobContext.jobRunId = info.jobRunId;
    jobContext.filesInfo = new RedisFileCollection(jobRunId, info.filesInfo.numMessages, info.filesInfo.lastId, this.redisClient);
    jobContext.dirsInfo = new RedisDirectoryCollection(jobRunId, info.dirsInfo.numMessages, info.dirsInfo.lastId, this.redisClient);
    jobContext.errorsInfo = new RedisErrorCollection(jobRunId, info.errorsInfo.numMessages, info.errorsInfo.lastId, this.redisClient);
    jobContext.tasksInfo = new RedisTaskCollection(jobRunId, info.tasksInfo.numMessages, info.tasksInfo.lastId, this.redisClient);
    jobContext.taskStats = new RedisTaskStatsCollection(jobRunId, info.taskStats.numMessages, info.taskStats.lastId, this.redisClient);
    jobContext.updatedTaskInfo = new RedisUpdatedTasksCollection(jobRunId, info.updatedTaskInfo.numMessages, info.updatedTaskInfo.lastId, this.redisClient);
    jobContext.migrateTask = new RedisMigrationTasksCollection(jobRunId, info.migrateTask.numMessages, info.migrateTask.lastId, this.redisClient);
    return jobContext;
  }
}


export class RedisSpeedTestJobContextProvider implements SpeedTestJobContextProvider {

  constructor(private readonly redisClient: RedisClientType) {}

  async buildContext(
    jobRunId: string,
    jobConfig: SpeedTestJobConfig,
    jobStatus: string,
    jobState: JobState,
  ): Promise<SpeedTestJobContext> {
    const jobContext = new RedisSpeedTestJobContext(
      jobRunId,
      this.redisClient,
      jobConfig,
      jobStatus,
      jobState
    );
    await jobContext.init();
    return jobContext;
  }

  async getJobContext(jobRunId: string): Promise<SpeedTestJobContext | null> {
    const jobContext = new RedisSpeedTestJobContext(jobRunId, this.redisClient);
    const value = await this.redisClient.get(jobRunId);

    if (!value) {

      return null;
    }

    let info = value ? jobContext.deserialize(value) : { filesInfo: { numMessages: 0, lastId: '0-0' }, 
                                                    dirsInfo: { numMessages: 0, lastId: '0-0' }, 
                                                    errorsInfo: { numMessages: 0, lastId: '0-0' },
                                                    tasksInfo: { numMessages: 0, lastId: '0-0' },
                                                    migrateTask: { numMessages: 0, lastId: '0-0' },
                                                    taskStats: { numMessages: 0, lastId: '0-0' },
                                                    updatedTaskInfo: { numMessages: 0, lastId: '0-0' } };
    jobContext.jobConfig = info.jobConfig;
    jobContext.jobRunStatus = info.jobRunStatus;
    jobContext.jobState = info.jobState;
    jobContext.jobRunId = info.jobRunId;
    jobContext.filesInfo = new RedisFileCollection(jobRunId, info.filesInfo.numMessages, info.filesInfo.lastId, this.redisClient);
    jobContext.dirsInfo = new RedisDirectoryCollection(jobRunId, info.dirsInfo.numMessages, info.dirsInfo.lastId, this.redisClient);
    jobContext.errorsInfo = new RedisErrorCollection(jobRunId, info.errorsInfo.numMessages, info.errorsInfo.lastId, this.redisClient);
    jobContext.tasksInfo = new RedisTaskCollection(jobRunId, info.tasksInfo.numMessages, info.tasksInfo.lastId, this.redisClient);
    jobContext.taskStats = new RedisTaskStatsCollection(jobRunId, info.taskStats.numMessages, info.taskStats.lastId, this.redisClient);
    jobContext.speedTestReadWritesData = new RedisSpeedTestReadWriteCollection(jobRunId, info.taskStats.numMessages, info.taskStats.lastId, this.redisClient);
    jobContext.updatedTaskInfo = new RedisUpdatedTasksCollection(jobRunId, info.updatedTaskInfo.numMessages, info.updatedTaskInfo.lastId, this.redisClient);
    jobContext.migrateTask = new RedisMigrationTasksCollection(jobRunId, info.migrateTask.numMessages, info.migrateTask.lastId, this.redisClient);
    return jobContext;
  }
}
