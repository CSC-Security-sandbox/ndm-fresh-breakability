import { RedisMemoryCheckActivity } from './redis.mem.usage.check.activity';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

describe('RedisMemoryCheckActivity', () => {
  let redisMemoryCheckActivity: RedisMemoryCheckActivity;
  let mockRedisService: { getMemoryInfo: jest.Mock };
  // for making all logger methods optional
  let mockLogger: Partial<Logger>; 
  // for making all config methods optional
  let mockConfigService: Partial<ConfigService>;

  const memoryUsageThreshold = 90;

  beforeEach(() => {
    // Create mocks
    mockRedisService = {
      getMemoryInfo: jest.fn()
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn()
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(memoryUsageThreshold)
    };

    redisMemoryCheckActivity = new RedisMemoryCheckActivity(
      mockRedisService as any,
      mockLogger as Logger,
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
    expect(mockLogger.log).toHaveBeenCalledWith(
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
    expect(mockLogger.log).toHaveBeenCalledWith(
      `Redis Memory Usage : ${JSON.stringify(memoryInfo)}`
    );
  });

  it('should throw an error and log it when redisService.getMemoryInfo fails', async () => {
    const errorMsg = 'Test error';
    mockRedisService.getMemoryInfo.mockRejectedValue(new Error(errorMsg));

    await expect(redisMemoryCheckActivity.checkMemoryUsage()).rejects.toThrow(errorMsg);
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Error fetching Redis memory info: Error: ${errorMsg}`
    );
  });
});