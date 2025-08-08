import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NativeConnection, Worker } from '@temporalio/worker';
import { firstValueFrom, retry, timeout, timer } from 'rxjs';
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

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(WorkerOptionsService)
    private readonly workerOptions: WorkerOptionsService,
    @Inject(AuthService) private readonly authService: AuthService,
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
      this.connection = await NativeConnection.connect(
        this.configService.get('temporal'),
      );
      this.temporalClientConnection = await Connection.connect(
        this.configService.get('temporal'),
      );
    } catch (err) {
      this.logger.error(`Error on setting temporal connection: ${err}`);
      throw err;
    }
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
      
      // Yield event loop before heavy operations
      await new Promise(resolve => setImmediate(resolve));
      
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) throw new Error('Access token is null');
      
      // Yield event loop before HTTP request
      await new Promise(resolve => setImmediate(resolve));
      
      // Increased timeout and added retry logic
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.workerConfigUrl}/api/v1/work-manager/config`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-client-platform': this.platform,
            },
            timeout: 15000, // Increased from 5000 to 15000ms
          },
        ).pipe(
          retry({ count: 2, delay: 1000 }), // Retry twice with 1s delay
          timeout(20000) // Overall timeout of 20s
        ),
      );
      
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch configurations. Status: ${response.status}`,
        );
      }
      this.logger.debug(
        `Fetched configurations: ${JSON.stringify(response.data)}`,
      );
      
      // Yield event loop before processing configurations
      await new Promise(resolve => setImmediate(resolve));
      
      await this.handleConfigurations(response.data);
      
      // Yield event loop before monitoring
      await new Promise(resolve => setImmediate(resolve));
      
      await this.monitorTaskQueues();
    } catch (error) {
      this.logger.error(`Error fetching configurations: ${error.message}`);
      
      // If timeout, wait a bit longer before next attempt
      if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
        this.logger.warn('Configuration fetch timed out, will retry in next cycle');
        // Add a small delay to prevent immediate retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
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
    
    // Yield event loop before processing configs
    await new Promise(resolve => setImmediate(resolve));
    
    for (let i = 0; i < configs.length; i++) {
      const id = getWorkerIdentity(configs[i]);
      if (!this.activeWorkers.has(id)) configsToStart.set(id, configs[i]);
      activeConfigs.add(id);
      
      // Yield occasionally during config processing
      if (i % 5 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    // Handle worker shutdowns
    for (let [id, worker] of this.activeWorkers) {
      if (!activeConfigs.has(id)) {
        this.logger.log(`Stopping worker ${id}`);
        
        // Yield before shutdown operation
        await new Promise(resolve => setImmediate(resolve));
        
        await this.shutdownWorker(worker, false);
        this.activeWorkers.delete(id);
        activeConfigs.delete(id);
      }
    }
    
    // Handle worker startups
    for (let [id, config] of configsToStart) {
      this.logger.log(`Starting worker ${id} ${JSON.stringify(config)}`);
      
      // Yield before each worker startup
      await new Promise(resolve => setImmediate(resolve));
      
      const workerOptions = this.workerOptions.createWorkerOptions(
        id,
        config,
        this.workerId,
        this.connection,
      );
      await this.startWorker(id, workerOptions);
      configsToStart.delete(id);
      
      // Yield after each worker startup to keep event loop responsive
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  async startWorker(id: string, workerOptions: any) {
    try {
      // Yield event loop before creating worker
      await new Promise(resolve => setImmediate(resolve));
      
      const worker: Worker = await Worker.create(workerOptions);
      
      if (worker.getState() === WorkerState.INITIALIZED) {
        worker.run();
      }
      
      // Add timeout protection for worker startup
      const startupTimeout = setTimeout(() => {
        this.logger.error(`Worker ${id} startup timed out after ${this.workerStartupTimeout * 10}ms`);
      }, this.workerStartupTimeout * 10);
      
      let attempts = 0;
      const maxAttempts = 30; // Prevent infinite loop
      
      while (worker.getState() !== WorkerState.RUNNING && attempts < maxAttempts) {
        this.logger.debug(
          `Waiting for ${worker.options.identity} to be RUNNING. Current state: ${worker.getState()} (attempt ${attempts + 1}/${maxAttempts})`,
        );
        
        // Yield event loop during wait
        await new Promise(resolve => setImmediate(resolve));
        
        // Sleep with shorter intervals for responsiveness
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(this.workerStartupTimeout, 1000)),
        );
        
        attempts++;
      }
      
      clearTimeout(startupTimeout);
      
      if (worker.getState() === WorkerState.RUNNING) {
        this.logger.log(`Worker ${id} started successfully`);
        this.activeWorkers.set(id, worker);
        this.taskQueuesToMonitor.push({
          queueName: workerOptions.taskQueue,
          workerId: id,
        });
      } else {
        throw new Error(`Worker ${id} failed to start after ${maxAttempts} attempts. Final state: ${worker.getState()}`);
      }
    } catch (err) {
      this.logger.error(`Error starting worker ${id}: ${err}`);
    }
  }

  async shutdownWorker(worker: Worker, force: boolean) {
    if (
      worker.getState() === WorkerState.RUNNING ||
      worker.getState() === WorkerState.INITIALIZED
    ) {
      worker.shutdown();
    }

    if (!force) {
      let attempts = 0;
      const maxAttempts = 20; // Prevent infinite loop
      
      while (worker.getState() !== WorkerState.STOPPED && attempts < maxAttempts) {
        this.logger.debug(
          `Waiting for ${worker.options.identity} to be STOPPED. Current state: ${worker.getState()} (attempt ${attempts + 1}/${maxAttempts})`,
        );
        
        // Yield event loop during shutdown wait
        await new Promise(resolve => setImmediate(resolve));
        
        // Sleep with shorter intervals
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(this.workerStartupTimeout, 1000)),
        );
        
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        this.logger.warn(`Worker ${worker.options.identity} shutdown timed out after ${maxAttempts} attempts`);
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
    
    // Yield event loop before monitoring
    await new Promise(resolve => setImmediate(resolve));
    
    for (const taskQueue of this.taskQueuesToMonitor) {
      try {
        // Yield event loop before each monitoring call
        await new Promise(resolve => setImmediate(resolve));
        
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
          const worker = this.activeWorkers.get(taskQueue.workerId);
          if (worker) {
            workerToShutDown.push(worker);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to describe task queue ${taskQueue.queueName}: ${error.message}`);
        // Continue with other queues even if one fails
      }
    }
    
    for (const worker of workerToShutDown) {
      this.logger.log(`Shutting down worker ${worker.options.identity}`);
      try {
        // Yield before shutdown
        await new Promise(resolve => setImmediate(resolve));
        
        await this.shutdownWorker(worker, true);
        this.activeWorkers.delete(worker.options.identity);
      } catch (err) {
        this.logger.error(
          `Error shutting down worker ${worker.options.identity}: ${err}`,
        );
      }
    }
  }
}