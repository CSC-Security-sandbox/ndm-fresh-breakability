import redisConfig from './redis.config';

describe('RedisConfig', () => {
  it('should return the default Redis configuration when REDIS_URL is not set', () => {
    delete process.env.REDIS_URL; // Ensure REDIS_URL is not set
    const config = redisConfig();
    expect(config).toEqual({
      url: 'redis:6379',
    });
  });

  it('should return the Redis configuration with the REDIS_URL from environment variables', () => {
    process.env.REDIS_URL = 'redis://custom-redis-url:6379';
    const config = redisConfig();
    expect(config).toEqual({
      url: 'redis://custom-redis-url:6379',
    });
  });
});
