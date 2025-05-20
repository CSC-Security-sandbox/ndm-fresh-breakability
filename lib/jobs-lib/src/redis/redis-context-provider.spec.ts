import { RedisJobContextProvider } from './redis-context-provider';
import { RedisClientType } from 'redis';
import { JobConfig } from '../types/job-config';
import { RedisJobContext } from './redis-job-context';
import { Logger } from '../utils/logging';
import { JobType } from 'src/types/enums';
import { FileServerDetails } from 'src/types/file-server';
import { NFS } from 'src/types/protocols';

jest.mock('redis');
jest.mock('./redis-job-context');
jest.mock('../utils/logging');

describe('RedisJobContextProvider', () => {
  let redisClient: jest.Mocked<RedisClientType>;
  let jobContextProvider: RedisJobContextProvider;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    redisClient = {
      get: jest.fn(),
    } as unknown as jest.Mocked<RedisClientType>;
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    (Logger.getLogger as jest.Mock).mockReturnValue(logger);
    jobContextProvider = new RedisJobContextProvider(redisClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buildContext', () => {
    it('should build and initialize job context', async () => {
      const jobRunId = 'test-job-run-id';
    const jobConfig = new JobConfig(
        jobRunId    ,
        JobType.DISCOVERY,
        new FileServerDetails(
          'localhost',
          [new NFS('root')],
          'user',
          'password',
          'domain',
        ),
        '/mnt/nfs'      
      );
      const jobStatus = 'running';
      const mockJobContext = {
        init: jest.fn(),
      } as unknown as jest.Mocked<RedisJobContext>;
      const jobState: any = {};

      (RedisJobContext as jest.Mock).mockImplementation(() => mockJobContext);

      const result = await jobContextProvider.buildContext(jobRunId, jobConfig, jobStatus, jobState);

      expect(logger.info).toHaveBeenCalledWith(`Building job context for job run id: ${jobRunId}`);
      expect(mockJobContext.init).toHaveBeenCalled();
      expect(result).toBe(mockJobContext);
    });
  });

  describe('getJobContext', () => {
    it('should retrieve and deserialize job context', async () => {
      const jobRunId = 'test-job-run-id';
      const mockValue = JSON.stringify({
        jobConfig: { /* mock job config */ },
        jobRunStatus: 'completed',
        jobRunId,
        filesInfo: { numMessages: 10, lastId: '1-0' },
        dirsInfo: { numMessages: 5, lastId: '2-0' },
        errorsInfo: { numMessages: 2, lastId: '3-0' },
        tasksInfo: { numMessages: 8, lastId: '4-0' },
        taskStats: { numMessages: 3, lastId: '5-0' },
        updatedTaskInfo: { numMessages: 1, lastId: '6-0' },
        migrateTask: { numMessages: 4, lastId: '7-0' },
      });
      redisClient.get.mockResolvedValue(mockValue);

      const mockJobContext = {
        deserialize: jest.fn().mockReturnValue(JSON.parse(mockValue)),
      } as unknown as jest.Mocked<RedisJobContext>;

      (RedisJobContext as jest.Mock).mockImplementation(() => mockJobContext);

      const result = await jobContextProvider.getJobContext(jobRunId);

      expect(logger.info).toHaveBeenCalledWith(`Retrieved job context for job run id: ${jobRunId}`);
      expect(mockJobContext.deserialize).toHaveBeenCalledWith(mockValue);
      expect(result).toBe(mockJobContext);
    });

    it('should return null if job context is not found', async () => {
      const jobRunId = 'test-job-run-id';
      redisClient.get.mockResolvedValue(null);

      const result = await jobContextProvider.getJobContext(jobRunId);

      expect(logger.warn).toHaveBeenCalledWith(`Job context not found for job run id: ${jobRunId}`);
      expect(result).toBeNull();
    });
  });
});