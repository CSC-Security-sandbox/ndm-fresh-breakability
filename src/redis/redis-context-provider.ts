import { JobContext } from '../types/job-context';
import { JobConfig } from '../types/job-config';
import { JobContextProvider } from '../job-context-provider';
import { RedisClientType } from 'redis';
import { RedisJobContext } from './redis-job-context';
import { Logger } from '../utils/logging';
import { RedisDirectoryCollection, RedisErrorCollection, RedisFileCollection, RedisTaskCollection, RedisTaskStatsCollection } from './redis-collections';

export class RedisJobContextProvider implements JobContextProvider {
  private logger: Logger;

  constructor(private readonly redisClient: RedisClientType) {
    this.logger = Logger.getLogger();
  }

  async buildContext(
    jobRunId: string,
    jobConfig: JobConfig,
    jobStatus: string,
  ): Promise<JobContext> {
    this.logger.info(`Building job context for job run id: ${jobRunId}`);
    const jobContext = new RedisJobContext(
      jobRunId,
      this.redisClient,
      jobConfig,
      jobStatus,
    );
    await jobContext.init();
    return jobContext;
  }

  async getJobContext(jobRunId: string): Promise<JobContext | null> {
    const jobContext = new RedisJobContext(jobRunId, this.redisClient);
    const value = await this.redisClient.get(jobRunId);

    if (!value) {
      this.logger.warn(`Job context not found for job run id: ${jobRunId}`);
      return null;
    }

    this.logger.info(`Retrieved job context for job run id: ${jobRunId}`);
    let info = value ? jobContext.deserialize(value) : { filesInfo: { numMessages: 0, lastId: '0-0' }, 
                                                    dirsInfo: { numMessages: 0, lastId: '0-0' }, 
                                                    errorsInfo: { numMessages: 0, lastId: '0-0' },
                                                    tasksInfo: { numMessages: 0, lastId: '0-0' },
                                                    taskStats: { numMessages: 0, lastId: '0-0' } };
    this.logger.debug('>> Deserialized:', info);
    jobContext.jobConfig = info.jobConfig;
    jobContext.jobRunStatus = info.jobRunStatus;
    jobContext.jobRunId = info.jobRunId;
    jobContext.filesInfo = new RedisFileCollection(jobRunId, info.filesInfo.numMessages, info.filesInfo.lastId, this.redisClient);
    jobContext.dirsInfo = new RedisDirectoryCollection(jobRunId, info.dirsInfo.numMessages, info.dirsInfo.lastId, this.redisClient);
    jobContext.errorsInfo = new RedisErrorCollection(jobRunId, info.errorsInfo.numMessages, info.errorsInfo.lastId, this.redisClient);
    jobContext.tasksInfo = new RedisTaskCollection(jobRunId, info.tasksInfo.numMessages, info.tasksInfo.lastId, this.redisClient);
    jobContext.taskStats = new RedisTaskStatsCollection(jobRunId, info.taskStats.numMessages, info.taskStats.lastId, this.redisClient);
    return jobContext;
  }
}
