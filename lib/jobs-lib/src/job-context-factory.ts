import { JobContextProvider } from './job-context-provider';
import { SpeedTestJobContextProvider } from './speed-test-job-context-provider';
import { RedisJobContextProvider, RedisSpeedTestJobContextProvider } from './redis/redis-context-provider';
import { JobManagerProvider, RedisJobManagerProvider } from './types/job-manager-context/job-manager-provider';

export class JobContextFactory {

  static getJobManagerProvider(type: 'redis' | 'memory', client: any): JobManagerProvider {
    switch (type) {
      case 'redis':
        return new RedisJobManagerProvider(client);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

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
