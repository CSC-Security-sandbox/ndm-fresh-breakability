import { DMError, FileInfo, SpeedTestReadWriteInfo, Task, TaskStats } from '../types/metadata-types';
import {
  DirectoryCollection,
  ErrorCollection,
  FileCollection,
  TaskCollection,
  TaskStatsCollection,
  UpdatedTaskCollection,
  SpeedTestReadWriteCollection,
  MigrationTaskCollection
} from '../types/stream-collection';
import { JobUtils } from '../utils/job-utils';
import { RedisStreamCollection } from './redis-stream-collection';

export class RedisFileCollection
  extends RedisStreamCollection<FileInfo>
  implements FileCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'files'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisErrorCollection
  extends RedisStreamCollection<DMError>
  implements ErrorCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'errors'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisTaskCollection
  extends RedisStreamCollection<Task>
  implements TaskCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'tasks'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisDirectoryCollection
  extends RedisStreamCollection<FileInfo>
  implements DirectoryCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'dirs'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisTaskStatsCollection
  extends RedisStreamCollection<TaskStats>
  implements TaskStatsCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'tasks-stats'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisSpeedTestReadWriteCollection
  extends RedisStreamCollection<SpeedTestReadWriteInfo>
  implements SpeedTestReadWriteCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'speed-test-read-write'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisUpdatedTasksCollection
  extends RedisStreamCollection<Task>
  implements UpdatedTaskCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'tasks-updated'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}


export class RedisMigrationTasksCollection
  extends RedisStreamCollection<Task>
  implements MigrationTaskCollection
{
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'migration-tasks'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}