import { RedisFileCollection, RedisErrorCollection, RedisTaskCollection, RedisDirectoryCollection, RedisTaskStatsCollection } from './redis-collections';
import { JobUtils } from '../utils/job-utils';
import { RedisStreamCollection } from './redis-stream-collection';

jest.mock('../utils/job-utils');
jest.mock('./redis-stream-collection');

describe('Redis Collections', () => {
  const jobRunId = 'test-job-run-id';
  const numMessages = 10;
  const lastId = '0-0';
  const redisClient = {};

  beforeEach(() => {
    (JobUtils.getRedisKey as jest.Mock).mockImplementation((jobRunId: string, type: string) => `${jobRunId}-${type}`);
  });

  describe('RedisFileCollection', () => {
    it('should initialize correctly', () => {
      const collection = new RedisFileCollection(jobRunId, numMessages, lastId, redisClient);
      expect(collection).toBeInstanceOf(RedisFileCollection);
      expect(RedisStreamCollection).toHaveBeenCalledWith(jobRunId, `${jobRunId}-files`, numMessages, lastId, redisClient);
    });
  });

  describe('RedisErrorCollection', () => {
    it('should initialize correctly', () => {
      const collection = new RedisErrorCollection(jobRunId, numMessages, lastId, redisClient);
      expect(collection).toBeInstanceOf(RedisErrorCollection);
      expect(RedisStreamCollection).toHaveBeenCalledWith(jobRunId, `${jobRunId}-errors`, numMessages, lastId, redisClient);
    });
  });

  describe('RedisTaskCollection', () => {
    it('should initialize correctly', () => {
      const collection = new RedisTaskCollection(jobRunId, numMessages, lastId, redisClient);
      expect(collection).toBeInstanceOf(RedisTaskCollection);
      expect(RedisStreamCollection).toHaveBeenCalledWith(jobRunId, `${jobRunId}-tasks`, numMessages, lastId, redisClient);
    });
  });

  describe('RedisDirectoryCollection', () => {
    it('should initialize correctly', () => {
      const collection = new RedisDirectoryCollection(jobRunId, numMessages, lastId, redisClient);
      expect(collection).toBeInstanceOf(RedisDirectoryCollection);
      expect(RedisStreamCollection).toHaveBeenCalledWith(jobRunId, `${jobRunId}-dirs`, numMessages, lastId, redisClient);
    });
  });

  describe('RedisTaskStatsCollection', () => {
    it('should initialize correctly', () => {
      const collection = new RedisTaskStatsCollection(jobRunId, numMessages, lastId, redisClient);
      expect(collection).toBeInstanceOf(RedisTaskStatsCollection);
      expect(RedisStreamCollection).toHaveBeenCalledWith(jobRunId, `${jobRunId}-tasks`, numMessages, lastId, redisClient);
    });
  });
});