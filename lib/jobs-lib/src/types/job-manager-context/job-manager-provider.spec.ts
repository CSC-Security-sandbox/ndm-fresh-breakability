import { RedisJobManagerProvider } from './job-manager-provider';
import { RedisJobManagerContext } from './job-manager-redis';
import { JobConfig } from '../job-config';
import { RedisClientType } from 'redis';

jest.mock('./job-manager-redis');

describe('RedisJobManagerProvider', () => {
    let redisClientMock: jest.Mocked<RedisClientType>;
    let provider: RedisJobManagerProvider;

    beforeEach(() => {
        redisClientMock = {} as any;
        provider = new RedisJobManagerProvider(redisClientMock);
        (RedisJobManagerContext as jest.Mock).mockClear();
    });

    describe('buildContext', () => {
        it('should create and initialize a RedisJobManagerContext', async () => {
            const jobRunId = 'run-123';
            const jobConfig = { foo: 'bar' } as unknown as JobConfig;
            const jobStatus = 'pending';

            const initMock = jest.fn().mockResolvedValue(undefined);
            (RedisJobManagerContext as jest.Mock).mockImplementation(() => ({
                init: initMock,
            }));

            const context = await provider.buildContext(jobRunId, jobConfig, jobStatus);

            expect(RedisJobManagerContext).toHaveBeenCalledWith(redisClientMock, jobRunId, jobConfig, jobStatus);
            expect(initMock).toHaveBeenCalled();
            expect(context).toBeDefined();
        });
    });

    describe('getContext', () => {
        it('should create and initialize a RedisJobManagerContext instance', async () => {
            const jobRunId = 'run-456';

            const initializeInstanceMock = jest.fn().mockResolvedValue(undefined);
            (RedisJobManagerContext as jest.Mock).mockImplementation(() => ({
                initializeInstance: initializeInstanceMock,
            }));

            const context = await provider.getContext(jobRunId);

            expect(RedisJobManagerContext).toHaveBeenCalledWith(redisClientMock, jobRunId);
            expect(initializeInstanceMock).toHaveBeenCalled();
            expect(context).toBeDefined();
        });
    });
});