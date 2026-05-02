import { JobContext, JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { firstValueFrom } from 'rxjs';

export interface RedisCredentials {
  host: string;
  port?: string;
  username: string;
  password: string;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger : LoggerService;
  private jwtAuthEnabled: boolean;
  private connectionRefreshInterval: NodeJS.Timeout;

  constructor (
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {
    this.logger = loggerFactory.create(RedisService.name);
    this.jwtAuthEnabled = this.configService.get<string>('REDIS_JWT_AUTH_ENABLED') === 'true';
  }

  private isLocalEnvironment(workerConfigUrl: string): boolean {    
    return workerConfigUrl?.includes('localhost') || workerConfigUrl?.includes('127.0.0.1');
  }

  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Initializing Redis service...');
      this.logger.log(`JWT Authentication: ${this.jwtAuthEnabled ? 'ENABLED' : 'DISABLED'}`);
      
      await this.fetchAndUpdateRedisCredentials();
      
      // Create client with timeout to prevent hanging NestJS initialization
      await Promise.race([
        this.createClient(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout after 10s')), 10000)
        )
      ]);
      
      // Setup connection refresh for JWT auth
      if (this.jwtAuthEnabled) {
        this.setupConnectionRefresh();
      }
      
      this.logger.log('Redis service initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Redis service: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Clear connection refresh interval
    if (this.connectionRefreshInterval) {
      clearInterval(this.connectionRefreshInterval);
      this.logger.log('Redis connection refresh interval cleared');
    }
    
    if (this.client && this.client.isOpen) {
      await this.client.quit();
      this.logger.log('Redis client disconnected');
    }
  }

  private async fetchRedisCredentials(): Promise<RedisCredentials> {
    const workerConfigUrl = this.configService.get('worker.connection.workerConfigUrl');
    const workerId = this.configService.get('worker.workerId');

    this.logger.debug('=== Starting Redis credentials fetch ===');
    this.logger.debug(`Worker ID: ${workerId}`);

    if (this.isLocalEnvironment(workerConfigUrl)) {
      return  {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT || '6379',
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
      };
    }

    try {
      // Get access token
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      // Fetch Redis credentials from API
      const response = await firstValueFrom(
        this.httpService.get(
          `${workerConfigUrl}/api/v1/secrets/redis`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        ),
      );

      if (response.status !== 200) {
        throw new Error(`Failed to fetch Redis credentials. Status: ${response.status}`);
      }

      // Parse Redis credentials
      const data = response.data?.data?.items;
      if (!data?.host || !data?.username || !data?.password) {
        throw new Error('Incomplete Redis credentials received from API');
      }

      const redisCredentials: RedisCredentials = {
        host: data.host,
        port: data.port || '6379',
        username: data.username,
        password: data.password,
      };

      this.logger.log('Redis credentials fetched successfully:');
      this.logger.debug(`  Host: ${redisCredentials.host}`);
      this.logger.debug(`  Port: ${redisCredentials.port}`);
      this.logger.debug(`  Username: ${redisCredentials.username}`);
      this.logger.debug(`  Password length: ${redisCredentials.password.length}`);

      return redisCredentials;

    } catch (error) {
      this.logger.error(`Failed to fetch Redis credentials: ${error.message}`);
      throw new Error(`Redis credentials are required for worker operation: ${error.message}`);
    }
  }

  private updateRedisConfig(credentials: RedisCredentials): void {
    if (!credentials) {
      throw new Error('Redis credentials not available');
    }

    // Update environment variables with Redis credentials
    process.env.REDIS_USERNAME = credentials.username;
    process.env.REDIS_PASSWORD = credentials.password;

    this.logger.log('Redis configuration updated successfully');
  }

  private async fetchAndUpdateRedisCredentials(): Promise<void> {
    const credentials = await this.fetchRedisCredentials();
    this.updateRedisConfig(credentials);
  }

  async createClient(): Promise<void> {
    if (this.client && this.client.isOpen) {
      return;
    }

    if (this.jwtAuthEnabled) {
      await this.createJwtAuthClient();
    } else {
      await this.createTraditionalClient();
    }
  }

  private async createTraditionalClient(): Promise<void> {
    const redisClientOptions: any = {
      url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
    };

    if (process.env.REDIS_USERNAME && process.env.REDIS_PASSWORD) {
      redisClientOptions.username = process.env.REDIS_USERNAME;
      redisClientOptions.password = process.env.REDIS_PASSWORD;
    }

    this.logger.log(`Connecting to Redis at ${redisClientOptions.url}`);
    this.client = createClient(redisClientOptions);

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis');
    });

    await this.client.connect();
  }

  private async createJwtAuthClient(): Promise<void> {
    const gatewayHost = this.configService.get<string>('REDIS_GATEWAY_HOST');
    const gatewayPort = this.configService.get<string>('REDIS_GATEWAY_PORT') || '6379';
    const username = process.env.REDIS_USERNAME || 'default';
    
    // Get fresh JWT token
    const jwt = await this.authService.getAccessToken(true);
    if (!jwt) {
      throw new Error('Failed to get JWT for Redis authentication');
    }

    const redisClientOptions: any = {
      url: `rediss://${gatewayHost}:${gatewayPort}`,
      username: username,
      password: jwt, // JWT passed as password in AUTH command
      socket: {
        tls: true,
        rejectUnauthorized: false, // Accept self-signed certs in dev/test
      },
    };

    this.logger.log(`Connecting to Redis via Gateway at ${gatewayHost}:${gatewayPort} with JWT auth`);
    this.client = createClient(redisClientOptions);

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis via Gateway with JWT authentication');
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready - AUTH command succeeded');
    });

    await this.client.connect();
    this.logger.log('Redis connect() promise resolved');
  }

  private setupConnectionRefresh(): void {
    // Reuse JWT_REFRESH_INTERVAL_MINUTES from Temporal config (default: 1380 minutes = 23 hours)
    const tokenExpiryMinutes = parseInt(this.configService.get<string>('JWT_REFRESH_INTERVAL_MINUTES') || '1380', 10);
    
    // Use the same refresh interval as configured (already accounts for buffer time)
    const refreshIntervalMs = tokenExpiryMinutes * 60 * 1000;
    
    this.logger.log(`Setting up Redis connection refresh every ${tokenExpiryMinutes / 60} hours`);
    
    this.connectionRefreshInterval = setInterval(async () => {
      try {
        this.logger.log('Proactively refreshing Redis connection with new JWT...');
        await this.refreshConnection();
      } catch (error) {
        this.logger.error(`Failed to refresh Redis connection: ${error.message}`);
      }
    }, refreshIntervalMs);
  }

  private async refreshConnection(): Promise<void> {
    if (!this.jwtAuthEnabled) {
      this.logger.warn('Connection refresh called but JWT auth is disabled');
      return;
    }

    // Close existing connection
    if (this.client && this.client.isOpen) {
      this.logger.log('Closing existing Redis connection for refresh...');
      await this.client.quit();
    }

    // Create new connection with fresh JWT
    this.logger.log('Creating new Redis connection with fresh JWT...');
    await this.createJwtAuthClient();
    
    this.logger.log('Redis connection refreshed successfully');
  }

  private async ensureClient(): Promise<void> {
    if (!this.client || !this.client.isOpen) {
      this.logger.warn('Redis client not initialized. Attempting to reconnect...');
      await this.createClient();
    }
  }

  getClient(): RedisClientType {
    if (!this.client || !this.client.isOpen) {
      throw new Error('Redis client is not initialized yet.');
    }
    return this.client;
  }

  async getJobContext(traceId: string) {
    await this.ensureClient();
    const contextProvider = JobContextFactory.getProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async getJobManagerContext(traceId: string) {
    await this.ensureClient();
    const contextProvider = JobContextFactory.getJobManagerProvider('redis', this.client);
    return await contextProvider.getContext(traceId);
  }

  async getSpeedTestJobContext(traceId: string) {
    await this.ensureClient();
    const contextProvider = JobContextFactory.getSpeedTestProvider('redis', this.client);
    return await contextProvider.getJobContext(traceId);
  }

  async setJobContext(traceId: string, jobContext: any) {
    await this.ensureClient();
    const serializedContext = jobContext.serialize();
    await this.client.set(traceId, serializedContext);
  }
  async getJobState(traceId: string): Promise<any> {
    try {
      const jobContext = await this.getJobContext(traceId);
      return await jobContext.getJobState();
    } catch (error) {
      return { message: 'Error while getting the job state : ' + traceId };
    }
  }
  async setJobState(traceId: string, jobState: JobState): Promise<any> {
    try {
      const jobContext = await this.getJobContext(traceId);
      await jobContext.setJobState(jobState);
      const newJobState = await jobContext.getJobState();
      return newJobState;
    } catch (error) {
      return { message: 'Error while updating the job state : ' + traceId };
    }
  }
  async getOwnerIdentity(jobRunId: string, id: string, type: 'SID' | 'UID' | 'GID') {
    return await this.client.hGet(`${jobRunId}:mapping`, `${type}:${id}`)
  }

  async setOwnerIdentity(jobRunId: string, id: string, type: 'SID' | 'UID' | 'GID', owner: string) {
    if (!id || !owner) {
      this.logger.warn(`Skipping invalid identity mapping write: jobRunId=${jobRunId}, type=${type}, id=${id}, owner=${owner}`);
      return;
    }
    return await this.client.hSet(`${jobRunId}:mapping`, `${type}:${id}`, owner);
  }

  async getMemoryInfo(): Promise<{ used_memory: number; total_system_memory: number; maxmemory: number }> {
    await this.ensureClient();
    const memoryInfo = await this.client.info('memory');
    const parsedInfo = this.parseMemoryStats(memoryInfo);
    return parsedInfo;
  }
  parseMemoryStats(stats: string): { used_memory: number; total_system_memory: number; maxmemory: number } {
    let usedMemory = 0;
    let totalSystemMemory = 0;
    let maxmemory = 0;

    stats.split('\n').forEach((line) => {
      if (line.startsWith('used_memory:')) {
        usedMemory = parseInt(line.split(':')[1], 10);
      } else if (line.startsWith('total_system_memory:')) {
        totalSystemMemory = parseInt(line.split(':')[1], 10);
      } else if (line.startsWith('maxmemory:')) {
        maxmemory = parseInt(line.split(':')[1], 10);
      }
    });
    return {
      used_memory: usedMemory,
      total_system_memory: totalSystemMemory,
      maxmemory,
    };
  }


  async getMappingKeys(jobRunId: string, type: 'SID' | 'UID' | 'GID'): Promise<string[]> {
    await this.ensureClient();
    const fields = await this.client.hKeys(`${jobRunId}:mapping`);
    return fields.filter(f => f.startsWith(`${type}:`)).map(f => f.split(':')[1]);
  }
    
}
