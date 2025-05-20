import { RedisJobContext } from './redis-job-context';
import { RedisClientType } from 'redis';
import { Logger } from '../utils/logging';
import { RedisFileCollection, RedisDirectoryCollection, RedisErrorCollection, RedisTaskCollection, RedisTaskStatsCollection } from './redis-collections';

jest.mock('redis');
jest.mock('../utils/logging');
jest.mock('./redis-collections');

describe('RedisJobContext', () => {
    let redisClient: RedisClientType;
    let logger: Logger;
    let redisJobContext: RedisJobContext;

    beforeEach(() => {
        redisClient = {
            exists: jest.fn(),
            del: jest.fn(),
            set: jest.fn(),
            stats: jest.fn(),
            hIncrBy: jest.fn(),
            disconnect: jest.fn(),
            keys: jest.fn().mockReturnValue([]),
        } as unknown as RedisClientType;

        logger = {
            info: jest.fn(),
        } as unknown as Logger;

        (Logger.getLogger as jest.Mock).mockReturnValue(logger);

        redisJobContext = new RedisJobContext('jobRunId', redisClient);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize collections and set jobRunId in Redis', async () => {
        (redisClient.exists as jest.Mock).mockResolvedValue(true);
        (RedisFileCollection.prototype.init as jest.Mock).mockResolvedValue(undefined);
        (RedisDirectoryCollection.prototype.init as jest.Mock).mockResolvedValue(undefined);
        (RedisErrorCollection.prototype.init as jest.Mock).mockResolvedValue(undefined);
        (RedisTaskCollection.prototype.init as jest.Mock).mockResolvedValue(undefined);
        (RedisTaskStatsCollection.prototype.init as jest.Mock).mockResolvedValue(undefined);

        await redisJobContext.init();

        expect(redisClient.exists).toHaveBeenCalledWith('jobRunId');
        expect(redisClient.del).toHaveBeenCalledWith('jobRunId');
        expect(logger.info).toHaveBeenCalledWith('Cleaning up existing key: jobRunId');
        expect(redisClient.set).toHaveBeenCalledWith('jobRunId', expect.any(String));
    });

    it('should close collections and set jobRunId in Redis', async () => {
        redisJobContext.setStat('key', 1);

        await redisJobContext.close();

        expect(redisClient.set).toHaveBeenCalledWith('jobRunId', expect.any(String));
        expect(redisClient.hIncrBy).toHaveBeenCalledWith('stats:jobRunId', 'key', 1);
        expect(redisClient.disconnect).toHaveBeenCalled();
    });

    it('should clean up existing state for jobRunId', async () => {
        (redisClient.exists as jest.Mock).mockResolvedValue(true);

        await redisJobContext.cleanup();

        expect(redisClient.exists).toHaveBeenCalledWith('jobRunId');
       // expect(redisClient.del).toHaveBeenCalledWith('jobRunId');
        //expect(logger.info).toHaveBeenCalledWith('Cleaning up existing state for Job Run Id: jobRunId');
    });

    it('should not clean up if jobRunId does not exist', async () => {
        (redisClient.exists as jest.Mock).mockResolvedValue(false);

        await redisJobContext.cleanup();

        expect(redisClient.exists).toHaveBeenCalledWith('jobRunId');
        expect(redisClient.del).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalledWith('Cleaning up existing state for Job Run Id: jobRunId');
    });
});