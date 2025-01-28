import { JobContextFactory } from './job-context-factory';
import { RedisJobContextProvider } from './redis/redis-context-provider';

describe('JobContextFactory', () => {
  it('should return RedisJobContextProvider when type is redis', () => {
    const client = {}; // Mock client
    const provider = JobContextFactory.getProvider('redis', client);
    expect(provider).toBeInstanceOf(RedisJobContextProvider);
  });

  it('should throw an error for unknown provider type', () => {
    const client = {}; // Mock client
    expect(() => {
      JobContextFactory.getProvider('memory', client);
    }).toThrowError('Unknown provider type: memory');
  });
});