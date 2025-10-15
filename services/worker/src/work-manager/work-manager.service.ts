import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NativeConnection, Worker } from '@temporalio/worker';
import { firstValueFrom } from 'rxjs';
import {
  Platform,
  WorkerConfiguration,
  WorkerState,
} from './work-manager.types';
import {
  getPlatform,
  getWorkerIdentity,
} from 'src/utils/worker-manager.mappers';
import { KeycloakConfig } from 'src/config/keycloak.config';
import { WorkerOptionsService } from './factory/worker-options.factory.service';
import { AuthService } from 'src/auth/auth.service';
import { Connection } from '@temporalio/client';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { RedisService } from '../redis/redis.service';

interface RedisCredentials {
  host: string;
  username: string;
  password: string;
}

@Injectable()
export class WorkManagerService {
  readonly workerConfigUrl: string;
  private loadingConfigs = false;
  readonly workerId: string;
  readonly keycloakConfig: KeycloakConfig;
  readonly tokenRequest: string;
  private connection: NativeConnection = null;
  private activeWorkers: Map<string, Worker> = new Map<string, Worker>();
  private readonly workerStartupTimeout: number;
  private taskQueuesToMonitor = [];
  private temporalClientConnection: Connection = null;
  private platform: Platform;
  private readonly logger: LoggerService;
  private isRebootCall: boolean = true;
  private redisCredentials: RedisCredentials = null;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(WorkerOptionsService)
    private readonly workerOptions: WorkerOptionsService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(RedisService) private readonly redisService: RedisService, // ← ADD THIS

  ) {
    this.workerConfigUrl = `${this.configService.get('worker.connection.workerConfigUrl')}`;
    this.workerId = this.configService.get('worker.workerId');
    this.workerStartupTimeout = this.configService.get(
      'worker.workerStartupTimeout',
    );
    this.platform = getPlatform(this.configService.get('worker.platform'));
    this.logger = loggerFactory.create(WorkManagerService.name);
  }
  async onApplicationBootstrap() {
    this.logger.log('[onApplicationBootstrap] - Starting Worker Service');
    try {

      await this.fetchRedisCredentials();
      
      this.updateRedisConfig();

       // Force Redis to reconnect with new credentials
      this.logger.log('Forcing Redis reconnection with new credentials...');
      this.logger.log(`AFTER: Should connect to Redis at redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`);
      await this.redisService.onModuleDestroy(); // Disconnect old connection
      await this.redisService.createClient();      // Reconnect with new credentials
    

      this.connection = await NativeConnection.connect(
        this.configService.get('temporal'),
      );
      this.temporalClientConnection = await Connection.connect(
        this.configService.get('temporal'),
      );

      this.logger.log('Worker service initialized successfully with dynamic Redis credentials');

    } catch (err) {
      this.logger.error(`Error during worker service initialization: ${err}`);
      throw err;
    }
  }

  private async fetchRedisCredentials(): Promise<void> {
    this.logger.log('=== Starting Redis credentials fetch ===');
    this.logger.log(`Worker ID: ${this.workerId}`);
    
    try {
      // Get access token
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      // Fetch Redis credentials from API
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.workerConfigUrl}/api/v1/secrets/redis`,
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

      this.logger.debug(`Redis response: ${JSON.stringify(response.data)}`);

      // Parse Redis credentials
      const data = response.data?.data?.items;
      if (!data?.host || !data?.username || !data?.password) {
        throw new Error('Incomplete Redis credentials received from API');
      }

      this.redisCredentials = {
        host: data.host,
        username: data.username,
        password: data.password,
      };

      this.logger.log('Redis credentials fetched successfully:');
      this.logger.log(`  Host: ${this.redisCredentials.host}`);
      this.logger.log(`  Username: ${this.redisCredentials.username}`);
      this.logger.log(`  Password length: ${this.redisCredentials.password.length}`);

    } catch (error) {
      this.logger.error(`Failed to fetch Redis credentials: ${error.message}`);
      throw new Error(`Redis credentials are required for worker operation: ${error.message}`);
    }
  }

  private updateRedisConfig(): void {
    if (!this.redisCredentials) {
      throw new Error('Redis credentials not available');
    }

    // Update environment variables or config service with Redis credentials
    process.env.REDIS_USERNAME = this.redisCredentials.username;
    process.env.REDIS_PASSWORD = this.redisCredentials.password;

    this.logger.log('Redis configuration updated successfully');
  }


  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    if (this.loadingConfigs) {
      this.logger.debug('Already loading configurations, skipping this cycle.');
      return;
    }
    this.logger.log(`Fetching configurations for platform: ${this.platform}`);

    try {
      this.loadingConfigs = true;
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) throw new Error('Access token is null');
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.workerConfigUrl}/api/v1/work-manager/config`,
          {
            envVariables: process.env,
            isRebootCall: this.isRebootCall,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-client-platform': this.platform,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          },
        ),
      );
      this.isRebootCall = false;
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch configurations. Status: ${response.status}`,
        );
      }
      this.logger.debug(`Received response: ${JSON.stringify(response.data)}`);
      this.logger.debug(
        `Fetched configurations: ${JSON.stringify(response.data.data.items)}`,
      );
      await this.handleConfigurations(response.data.data.items);
      await this.monitorTaskQueues();
    } catch (error) {
      this.logger.error(`Error fetching configurations: ${error.message}`);
    } finally {
      this.loadingConfigs = false;
    }
  }

  async handleConfigurations(configs: WorkerConfiguration[]) {
    let activeConfigs: Set<string> = new Set<string>();
    let configsToStart: Map<string, WorkerConfiguration> = new Map<
      string,
      WorkerConfiguration
    >();
    for (let i = 0; i < configs.length; i++) {
      const id = getWorkerIdentity(configs[i]);
      if (!this.activeWorkers.has(id)) configsToStart.set(id, configs[i]);
      activeConfigs.add(id);
    }
    for (let [id, worker] of this.activeWorkers) {
      if (!activeConfigs.has(id)) {
        this.logger.log(`Stopping worker ${id}`);
        await this.shutdownWorker(worker, false);
        this.activeWorkers.delete(id);
        activeConfigs.delete(id);
      }
    }
    for (let [id, config] of configsToStart) {
      this.logger.log(`Starting worker ${id} ${JSON.stringify(config)}`);
      const workerOptions = this.workerOptions.createWorkerOptions(
        id,
        config,
        this.workerId,
        this.connection,
      );
      await this.startWorker(id, workerOptions);
      configsToStart.delete(id);
    }
  }

  async startWorker(id: string, workerOptions: any) {
    try {
      const worker: Worker = await Worker.create(workerOptions);
      if (worker.getState() === WorkerState.INITIALIZED) worker.run();
      while (worker.getState() !== WorkerState.RUNNING) {
        this.logger.debug(
          `Waiting for ${worker.options.identity} to be RUNNING. Current state: ${worker.getState()}`,
        );
        //sleep
        await new Promise((resolve) =>
          setTimeout(resolve, this.workerStartupTimeout),
        );
      }
      this.logger.log(`Worker ${id} started successfully`);
      this.activeWorkers.set(id, worker);
      this.taskQueuesToMonitor.push({
        queueName: workerOptions.taskQueue,
        workerId: id,
      });
    } catch (err) {
      this.logger.error(`Error starting worker ${id}: ${err}`);
    }
  }

  async shutdownWorker(worker: Worker, force: boolean) {
    if (
      worker.getState() === WorkerState.RUNNING ||
      worker.getState() === WorkerState.INITIALIZED
    )
      worker.shutdown();

    if (!force) {
      while (worker.getState() !== WorkerState.STOPPED) {
        this.logger.log(
          `Waiting for ${worker.options.identity} to be STOPPED. Current state: ${worker.getState()}`,
        );
        //sleep
        await new Promise((resolve) =>
          setTimeout(resolve, this.workerStartupTimeout),
        );
      }
    } else {
      setTimeout(() => {
        if (worker.getState() !== WorkerState.STOPPED)
          this.logger.debug('Worker did not shutdown');
        else this.logger.debug('Worker shutdown');
      }, this.workerStartupTimeout);
    }
    // remove task queue from taskQueueArr
    this.taskQueuesToMonitor = this.taskQueuesToMonitor.filter(
      (taskQueue) => taskQueue.workerId !== worker.options.identity,
    );
  }

  async monitorTaskQueues() {
    const workerToShutDown = [];
    for (const taskQueue of this.taskQueuesToMonitor) {
      const response: any =
        await this.temporalClientConnection.workflowService.describeTaskQueue({
          namespace: 'default',
          taskQueue: { name: taskQueue.queueName, kind: 1 },
        });
      const pollers = response.pollers || [];
      if (pollers.length == 0) {
        this.logger.log(
          `No active workers for task queue: ${taskQueue.queueName}`,
        );
        workerToShutDown.push(this.activeWorkers.get(taskQueue.workerId));
      }
    }
    for (const worker of workerToShutDown) {
      this.logger.log(`Shutting down worker ${worker.options.identity}`);
      try {
        await this.shutdownWorker(worker, true);
      } catch (err) {
        this.logger.error(
          `Error shutting down worker ${worker.options.identity}: ${err}`,
        );
      }
      this.activeWorkers.delete(worker.options.identity);
    }
  }
}
