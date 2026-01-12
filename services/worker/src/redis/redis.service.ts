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

  constructor (
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {
    this.logger = loggerFactory.create(RedisService.name);
  }

  private isLocalEnvironment(workerConfigUrl: string): boolean {    
    return workerConfigUrl?.includes('localhost') || workerConfigUrl?.includes('127.0.0.1');
  }

  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Initializing Redis service...');
      
      await this.fetchAndUpdateRedisCredentials();
      
      await this.createClient();
      
      this.logger.log('Redis service initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Redis service: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
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
    process.env.REDIS_HOST = credentials.host;
    process.env.REDIS_PORT = credentials.port || '6379';
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
    return await this.client.hSet(`${jobRunId}:mapping`, `${type}:${id}`, owner);
  }

  async getMemoryInfo(): Promise<{ used_memory: number; total_system_memory: number }> {
    await this.ensureClient();
    const memoryInfo = await this.client.info('memory');
    const parsedInfo = this.parseMemoryStats(memoryInfo);
    return parsedInfo;
  }
  parseMemoryStats(stats: string): { used_memory: number; total_system_memory: number } {
    let usedMemory = 0;
    let totalSystemMemory = 0;
  
    stats.split('\n').forEach((line) => {
      if (line.startsWith('used_memory:')) {
        usedMemory = parseInt(line.split(':')[1], 10);
      } else if (line.startsWith('total_system_memory:')) {
        totalSystemMemory = parseInt(line.split(':')[1], 10);
      }
    });
    return {
      used_memory: usedMemory,
      total_system_memory: totalSystemMemory,
    };
  }


  async getMappingKeys(jobRunId: string, type: 'SID' | 'UID' | 'GID'): Promise<string[]> {
    await this.ensureClient();
    const fields = await this.client.hKeys(`${jobRunId}:mapping`);
    return fields.filter(f => f.startsWith(`${type}:`)).map(f => f.split(':')[1]);
  }
    
}
