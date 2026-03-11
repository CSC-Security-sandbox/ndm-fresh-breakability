import {
  Injectable,
  Inject,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobContextFactory,
  RedisUtils,
} from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { createClient, RedisClientType } from 'redis';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger: LoggerService;
  private connectionRefreshInterval: NodeJS.Timeout | null = null;
  private readonly jwtAuthEnabled: boolean;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.logger = loggerFactory.create(RedisService.name);
    this.jwtAuthEnabled =
      this.configService.get<string>('REDIS_JWT_AUTH_ENABLED') !== 'false';
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('[DEBUG] RedisService.onModuleInit START');
    await this.createClient();

    // Setup automatic connection refresh only when using JWT auth
    if (this.jwtAuthEnabled) {
      this.setupConnectionRefresh();
    }

    this.logger.log(
      '[DEBUG] RedisService.onModuleInit END - createClient() and refresh setup completed',
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Clean up connection refresh interval
    if (this.connectionRefreshInterval) {
      clearInterval(this.connectionRefreshInterval);
      this.connectionRefreshInterval = null;
      this.logger.log('Redis connection refresh interval cleared');
    }

    if (this.client && this.client.isOpen) {
      await this.client.quit();
      this.logger.log('Redis client disconnected');
    }
  }
  async createClient(): Promise<void> {
    if (this.client && this.client.isOpen) {
      return;
    }

    const redisClientOptions: any = {
      url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
      username: process.env.REDIS_USERNAME || 'default',
    };

    if (this.jwtAuthEnabled) {
      // Get JWT token for authentication (production / Istio mode)
      const jwt = await this.authService.getAccessToken(true);
      if (!jwt) {
        throw new Error('Failed to obtain JWT token for Redis authentication');
      }
      redisClientOptions.password = jwt;
      this.logger.log(
        `Connecting to Redis at ${redisClientOptions.url} with JWT authentication`,
      );
    } else {
      // Use static password (local / docker-compose mode)
      if (process.env.REDIS_PASSWORD) {
        redisClientOptions.password = process.env.REDIS_PASSWORD;
      }
      this.logger.log(
        `Connecting to Redis at ${redisClientOptions.url} with password authentication`,
      );
    }
    this.client = createClient(redisClientOptions);

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      this.logger.log(
        'Connected to Redis via Gateway with JWT authentication (TCP socket established)',
      );
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready (JWT AUTH completed)');
    });

    await this.client.connect();
  }

  /**
   * Setup automatic Redis connection refresh to use fresh JWT tokens
   * Prevents connection failures when JWT tokens expire
   * Ensures only ONE refresh interval is active at a time
   */
  private setupConnectionRefresh(): void {
    // Clear any existing refresh interval to prevent duplicates
    if (this.connectionRefreshInterval) {
      this.logger.log(
        'Clearing existing connection refresh interval before creating new one',
      );
      clearInterval(this.connectionRefreshInterval);
      this.connectionRefreshInterval = null;
    }

    // Hardcode 23 hours refresh interval (1 hour before 24-hour token expiry)
    const tokenRefreshMinutes = 1380; // 23 hours

    // Refresh Redis connection with same interval as token refresh
    const refreshIntervalMs = tokenRefreshMinutes * 60 * 1000;

    this.logger.log(
      `Setting up Redis connection refresh every ${tokenRefreshMinutes / 60} hours`,
    );

    this.connectionRefreshInterval = setInterval(() => {
      void this.refreshConnection().catch((error: Error) => {
        this.logger.error(
          `Failed to refresh Redis connection: ${error.message}`,
        );
      });
      this.logger.log(
        'Proactively refreshing Redis connection with new JWT...',
      );
    }, refreshIntervalMs);
  }

  /**
   * Refresh Redis connection with a new JWT token
   * Closes existing connection and creates new one with fresh token
   */
  private async refreshConnection(): Promise<void> {
    if (!this.jwtAuthEnabled) {
      return; // No-op: static password does not need refreshing
    }

    // Close existing connection
    if (this.client && this.client.isOpen) {
      this.logger.log('Closing existing Redis connection for refresh...');
      await this.client.quit();
    }

    // Create new connection with fresh JWT
    this.logger.log('Creating new Redis connection with fresh JWT...');
    await this.createClient();

    this.logger.log('Redis connection refreshed successfully');
  }

  async ensureClient(): Promise<void> {
    if (!this.client || !this.client.isOpen) {
      this.logger.warn(
        'Redis client not initialized. Attempting to reconnect...',
      );
      await this.createClient();

      // Setup connection refresh only when using JWT auth
      if (this.jwtAuthEnabled && !this.connectionRefreshInterval) {
        this.setupConnectionRefresh();
      }
    }
  }

  async getClient(): Promise<RedisClientType> {
    if (!this.client || !this.client.isOpen) {
      this.logger.debug(
        'Redis client is not initialized yet. calling ensureClient again',
      );
      await this.ensureClient();
      this.logger.debug('Redis client initialized from ensureClient');
    }
    return this.client;
  }

  async getJobContext(traceId: string) {
    if (!this.client) {
      this.logger.error(
        '[Job-Service] Redis client is not initialized, trying to reconnect',
      );
      this.client = await this.getClient();
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    const contextProvider = JobContextFactory.getProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    if (!this.client) {
      this.logger.error(
        '[Job-Service] Redis client is not initialized, trying to reconnect',
      );
      this.client = await this.getClient();
      this.logger.log('[Job-Service] Redis client reconnected');
    }
    const serializedContext = jobContext.serialize();
    await this.client.set(traceId, serializedContext);
    this.logger.log(`[Job-Service] [${traceId}] Job context saved to Redis.`);
  }

  async getJobState(traceId: string): Promise<any> {
    try {
      const jobContext = await this.getJobContext(traceId);
      return jobContext.getJobState();
    } catch (error) {
      return { message: 'Error while getting the job state : ' + traceId };
    }
  }
  async setJobState(traceId: string, jobState: JobState): Promise<any> {
    try {
      const jobContext = await this.getJobContext(traceId);
      jobContext.setJobState(jobState);
      const newJobState = jobContext.getJobState();
      return newJobState;
    } catch (error) {
      return { message: 'Error while updating the job state : ' + traceId };
    }
  }
}
