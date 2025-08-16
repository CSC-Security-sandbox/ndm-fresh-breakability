import { RedisMemoryCheckActivity } from './redis.mem.usage.check.activity';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

let loggerFactory: LoggerFactory;
describe('RedisMemoryCheckActivity', () => {
  let redisMemoryCheckActivity: RedisMemoryCheckActivity;
  let mockRedisService: { getMemoryInfo: jest.Mock };
  // for making all logger methods optional
  let logger: LoggerService;
  // for making all config methods optional
  let mockConfigService: Partial<ConfigService>;

  const memoryUsageThreshold = 90;

  beforeEach(() => {
    // Create mocks
    mockRedisService = {
      getMemoryInfo: jest.fn()
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(memoryUsageThreshold)
    };

    loggerFactory = {
      create: jest.fn().mockReturnValue({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        requestContext: {} as any,
        parentContext: {} as any,
        setParentContext: jest.fn(),
      }),
    } as unknown as LoggerFactory;

    logger = loggerFactory.create(RedisMemoryCheckActivity.name);

    redisMemoryCheckActivity = new RedisMemoryCheckActivity(
      mockRedisService as any,
      loggerFactory as LoggerFactory,
      mockConfigService as ConfigService
    );
  });

  it('should return true when memory usage is below threshold', async () => {
    const memoryInfo = {
      used_memory: 40,
      total_system_memory: 100
    };
    mockRedisService.getMemoryInfo.mockResolvedValue(memoryInfo);

    const result = await redisMemoryCheckActivity.checkMemoryUsage();
    expect(result).toBe(true);
    expect(logger.log).toHaveBeenCalledWith(
      `Redis Memory Usage : ${JSON.stringify(memoryInfo)}`
    );
  });

  it('should return false when memory usage is above threshold', async () => {
    const memoryInfo = {
      used_memory: 95,
      total_system_memory: 100
    };
    mockRedisService.getMemoryInfo.mockResolvedValue(memoryInfo);

    const result = await redisMemoryCheckActivity.checkMemoryUsage();
    expect(result).toBe(false);
    expect(logger.log).toHaveBeenCalledWith(
      `Redis Memory Usage : ${JSON.stringify(memoryInfo)}`
    );
  });

  it('should throw an error and log it when redisService.getMemoryInfo fails', async () => {
    const errorMsg = 'Test error';
    mockRedisService.getMemoryInfo.mockRejectedValue(new Error(errorMsg));

    await expect(redisMemoryCheckActivity.checkMemoryUsage()).rejects.toThrow(errorMsg);
    expect(logger.error).toHaveBeenCalledWith(
      `Error fetching Redis memory info: Error: ${errorMsg}`
    );
  });
});