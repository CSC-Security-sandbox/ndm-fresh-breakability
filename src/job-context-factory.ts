import { JobContextProvider } from './job-context-provider';
import { RedisJobContextProvider } from './redis/redis-context-provider';

export class JobContextFactory {
  static getProvider(type: 'redis' | 'memory', client: any): JobContextProvider {
    switch (type) {
      case 'redis':
        return new RedisJobContextProvider(client);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}
