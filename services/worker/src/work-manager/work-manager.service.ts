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
      const accessToken = await this.authService.getAccessToken();
      if (!accessToken) throw new Error('Access token is null');
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.workerConfigUrl}/api/v1/work-manager/config`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-client-platform': this.platform,
            },
            timeout: 5000,
          },
        ),
      );
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch configurations. Status: ${response.status}`,
        );
      }
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
        this.logger.debug(
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