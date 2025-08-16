import { GroupReaderType } from 'src/types/enums';
import { DMError, FileInfo, SpeedTestReadWriteInfo, Task, TaskStats } from '../types/metadata-types';
import {
  DirectoryCollection,
  ErrorCollection,
  FileCollection,
  TaskCollection,
  TaskStatsCollection,
  UpdatedTaskCollection,
  SpeedTestReadWriteCollection,
  MigrationTaskCollection,
  CommandCollection,
  ItemInfoCollection,
  TaskInfoCollection
} from '../types/stream-collection';
import { JobUtils } from '../utils/job-utils';
import { RedisStreamCollection } from './redis-stream-collection';
import { encode } from 'msgpack-lite';
import { Cmd, ItemInfo, TaskInfo } from '../datatype/stream-datatypes';

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

  async ackAndCreateTask(groupType: GroupReaderType, ids: string[], tasks: Task[]) {
    const multi = this.redisClient.multi();
    multi.xAck(this.streamKey, `${this.jobRunId}-${groupType}`, ids);
    const taskStreamKey = JobUtils.getRedisKey(this.jobRunId, 'tasks');
    tasks.forEach(task => {
      const buffer = encode(task);
      multi.xAdd(taskStreamKey, '*', { obj: buffer.toString('base64') });
    });
    multi.xDel(this.streamKey, ids);
    try {
      const result = await multi.exec();
      return result;
    } catch (error) {
      console.error('Redis multi.exec error:', error);
      return false;
    }
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


export class RedisCommandCollection extends RedisStreamCollection<Cmd> 
implements CommandCollection {
  constructor(
    jobRunId: string,
    numMessages: number,
    lastId: string,
    redisClient: any,
  ) {
    super(
      jobRunId,
      JobUtils.getRedisKey(jobRunId, 'commands'),
      numMessages,
      lastId,
      redisClient,
    );
  }
}

export class RedisItemInfoCollection extends RedisStreamCollection<ItemInfo> 
implements ItemInfoCollection {
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

export class RedisTaskInfoCollection
  extends RedisStreamCollection<TaskInfo>
  implements TaskInfoCollection
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