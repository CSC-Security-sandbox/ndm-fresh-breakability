import { JobContextProvider } from './job-context-provider';
import { SpeedTestJobContextProvider } from './speed-test-job-context-provider';
import { RedisJobContextProvider, RedisSpeedTestJobContextProvider } from './redis/redis-context-provider';

export class JobContextFactory {
  static getProvider(type: 'redis' | 'memory', client: any): JobContextProvider {
    switch (type) {
      case 'redis':
        return new RedisJobContextProvider(client);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
  static getSpeedTestProvider(type: 'redis' | 'memory', client: any): SpeedTestJobContextProvider {
    switch (type) {
      case 'redis':
        return new RedisSpeedTestJobContextProvider(client);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}
