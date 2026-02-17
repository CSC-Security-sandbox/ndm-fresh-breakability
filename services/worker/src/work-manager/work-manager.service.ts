import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
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
import { getLocalIpAddress } from 'src/utils/network.utils';
import { temporal } from '@temporalio/proto';
import { 
  buildTemporalConfig,
  createTemporalConnections, 
  refreshTemporalConnections,
} from 'src/utils/temporal.utils';
import { TemporalConnectionConfig, TemporalConfig } from 'src/utils/temporal.types';

@Injectable()
export class WorkManagerService implements OnModuleDestroy{
  readonly workerConfigUrl: string;
  private loadingConfigs = false;
  readonly workerId: string;
  readonly keycloakConfig: KeycloakConfig;
  readonly tokenRequest: string;
  private connection: NativeConnection = null;
  private activeWorkers: Map<string, Worker> = new Map<string, Worker>();
  private workerRunPromises: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  private readonly workerStartupTimeout: number;
  private taskQueuesToMonitor = [];
  private temporalClientConnection: Connection = null;
  private platform: Platform;
  private readonly logger: LoggerService;
  private isRefreshingConnection = false; // Prevent concurrent refresh operations
  private temporalConfig: TemporalConfig = null;
  private readonly jwtRefreshInterval: number;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(WorkerOptionsService)
    private readonly workerOptions: WorkerOptionsService,
    @Inject(AuthService) private readonly authService: AuthService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.workerConfigUrl = `${this.configService.get('worker.connection.workerConfigUrl')}`;
    this.workerId = this.configService.get('worker.workerId');
    this.workerStartupTimeout = this.configService.get(
      'worker.workerStartupTimeout',
    );
    this.platform = getPlatform(this.configService.get('worker.platform'));
    // Convert minutes to milliseconds (default 23 hours = 1380 minutes)
    const jwtRefreshMinutes = parseInt(process.env.JWT_REFRESH_INTERVAL_MINUTES) || 1380;
    this.jwtRefreshInterval = jwtRefreshMinutes * 60 * 1000;
    this.logger = loggerFactory.create(WorkManagerService.name);
  }

  onModuleDestroy() {
    if(this.schedulerRegistry){
      this.schedulerRegistry.deleteInterval('jwtRefresh');
    }    
  }
  async onApplicationBootstrap() {
    this.logger.log('[onApplicationBootstrap] - Starting Worker Service');
    try {
      // Read worker version from versions.conf and set in process.env
      // so it gets sent to config-service during registration
      await this.loadWorkerVersion();

      // First, register with config service to get updated environment variables (including CA cert for TLS)
      this.logger.log('[onApplicationBootstrap] - Registering with config service');
      const accessToken = await this.authService.getAccessToken();
      const updatedEnvVariables = await this.registerAndGetEnvironment(accessToken);
      
      // Apply critical environment variables to process.env for Temporal config
      if (updatedEnvVariables.TEMPORAL_TLS_CA_CERT) {
        process.env.TEMPORAL_TLS_CA_CERT = updatedEnvVariables.TEMPORAL_TLS_CA_CERT;
        this.logger.log('[onApplicationBootstrap] - Applied TEMPORAL_TLS_CA_CERT from config service');
      }
      
      // Debug: Log Temporal-related environment variables
      this.logger.log(`[onApplicationBootstrap] - Current Temporal env vars:
        TEMPORAL_ADDRESS=${process.env.TEMPORAL_ADDRESS}
        TEMPORAL_TLS_ENABLED=${process.env.TEMPORAL_TLS_ENABLED}
        TEMPORAL_TLS_SERVER_NAME=${process.env.TEMPORAL_TLS_SERVER_NAME}
        TEMPORAL_TLS_CA_CERT=${process.env.TEMPORAL_TLS_CA_CERT ? `present (${process.env.TEMPORAL_TLS_CA_CERT.length} chars)` : 'not set'}
        TEMPORAL_JWT_ENABLED=${process.env.TEMPORAL_JWT_ENABLED}`);
      
      let config: TemporalConnectionConfig =  {
          address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
          tlsEnabled: process.env.TEMPORAL_TLS_ENABLED === 'true',
          tlsServerName: process.env.TEMPORAL_TLS_SERVER_NAME,
          tlsCaCert: process.env.TEMPORAL_TLS_CA_CERT,
          jwtEnabled: process.env.TEMPORAL_JWT_ENABLED === 'true',
          getAccessToken: () => this.authService.getAccessToken(),
        };
      // TODO: this needs to be changed if we need to update certificate also after x time.
      this.temporalConfig = await buildTemporalConfig(config, this.logger);
      this.temporalConfig.metadata = {
        authorization: `Bearer ${accessToken}`,
      }                  
      const connections = await createTemporalConnections(
        this.temporalConfig,
        this.logger,
      );

      this.connection = connections.nativeConnection;
      this.temporalClientConnection = connections.clientConnection;
      
      // Schedule JWT refresh with dynamic interval
      const intervalId = setInterval(() => {
        this.refreshTemporalConnectionCron();
      }, this.jwtRefreshInterval);
      
      this.schedulerRegistry.addInterval('jwtRefresh', intervalId);
      this.logger.log(`JWT refresh scheduled every ${this.jwtRefreshInterval / 1000 / 60} minutes`);
    } catch (err) {
      this.logger.error(`Error on setting temporal connection: ${err}`);
      throw err;
    }
  }

  /**
   * Read current_version from versions.conf and set process.env.WORKER_VERSION.
   * This gets sent to config-service during registration so CP knows the worker's version.
   */
  private async loadWorkerVersion(): Promise<void> {
    try {
      const versionsPath = process.platform === 'win32'
        ? this.configService.get<string>('worker.metrics.versionsPathWindows') || 'C:\\datamigrator\\conf\\versions.conf'
        : this.configService.get<string>('worker.metrics.versionsPathLinux') || '/opt/datamigrator/conf/versions.conf';

      const fs = require('fs');
      if (fs.existsSync(versionsPath)) {
        const content = fs.readFileSync(versionsPath, 'utf8');
        const match = content.match(/current_version=(.+)/);
        if (match && match[1]) {
          process.env.WORKER_VERSION = match[1].trim();
          this.logger.log(`Worker version: ${process.env.WORKER_VERSION}`);
          return;
        }
      }
      this.logger.warn('versions.conf not found or current_version missing, WORKER_VERSION not set');
    } catch (err) {
      this.logger.error(`Failed to read worker version: ${err.message || err}`);
    }
  }

  /**
   * Register with config service and retrieve updated environment variables
   * This must be called before connecting to Temporal to get CA certificate for TLS
   */
  private async registerAndGetEnvironment(accessToken: string): Promise<Record<string, any>> {
    this.logger.log('Registering with config-service and fetching environment variables');
    try {      
      if (!accessToken) throw new Error('Access token is null');
      
      // Get worker's actual local IP address
      const workerIp = getLocalIpAddress();
      this.logger.log(`Worker local IP address: ${workerIp}`);
      
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.workerConfigUrl}/api/v1/work-manager/config`,
          {
            envVariables: process.env,
            isRebootCall: true,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-client-platform': this.platform,
              'x-worker-ip': workerIp,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          },
        ),
      );
      
      if (response.status !== 200) {
        throw new Error(
          `Failed to register worker. Status: ${response.status}`,
        );
      }
      
      this.logger.log('Worker registered successfully');
      
      // Extract updated environment variables from response (ResponseInterceptor wraps data in items)
      const responseData = response.data?.data?.items || {};
      const envVariables = responseData.envVariables || {};
      this.logger.debug(`Received ${Object.keys(envVariables).length} environment variables from config service`);
      
      if (envVariables.TEMPORAL_TLS_CA_CERT) {
        this.logger.debug(`TEMPORAL_TLS_CA_CERT present with ${envVariables.TEMPORAL_TLS_CA_CERT.length} characters`);
        // Try to decode and verify the certificate
        try {
          const decoded = Buffer.from(envVariables.TEMPORAL_TLS_CA_CERT, 'base64').toString('utf8');
          this.logger.debug(`Certificate decoded, starts with: ${decoded.substring(0, 50)}`);
        } catch (err) {
          this.logger.error(`Failed to decode certificate: ${err.message}`);
        }
      } else {
        this.logger.debug('TEMPORAL_TLS_CA_CERT not received from config service');
      }
      
      return envVariables;
    } catch (error) {
      this.logger.error(`Error registering worker: ${error.message}`);
      throw error;
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
              'x-worker-ip': getLocalIpAddress(),
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
      this.logger.debug(`Received response: ${JSON.stringify(response.data)}`);
      
      // Extract metaConfig from response (ResponseInterceptor wraps data in items)
      const responseData = response.data.data.items || {};
      const metaConfig = responseData.metaConfig || [];
      this.logger.debug(
        `Fetched configurations: ${JSON.stringify(metaConfig)}`,
      );
      await this.handleConfigurations(metaConfig);
      await this.monitorTaskQueues();
    } catch (error) {
      this.logger.error(`Error fetching configurations: ${error.message}`);
      if(error.message?.includes('UNAUTHENTICATED: Jwt is expired')){
        await this.refreshTemporalConnectionCron();
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

  async startWorker(id: string, workerOptions: any, retryCount: number = 0) {
    const maxRetries = 3;
    const baseDelay = 2000;
    
    try {
      const worker: Worker = await Worker.create(workerOptions);
      const runPromise = worker.run();
      
      runPromise.catch((err) => {
        this.logger.error(`Worker ${id} run() failed: ${err.message || err}`);
        if (this.activeWorkers.has(id)) {
          this.activeWorkers.delete(id);
          this.workerRunPromises.delete(id);
          this.taskQueuesToMonitor = this.taskQueuesToMonitor.filter(
            (tq) => tq.workerId !== id,
          );
        }
      });
      
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
      this.workerRunPromises.set(id, runPromise);
      this.taskQueuesToMonitor.push({
        queueName: workerOptions.taskQueue,
        workerId: id,
      });
    } catch (err) {
      // Check if error is due to overlapping worker registration (old worker not fully cleaned up)
      const isOverlapError = err.message?.includes('overlapping worker task types') || 
                            err.message?.includes('Registration of multiple workers');
      
      if (isOverlapError && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
        this.logger.warn(
          `Worker ${id} registration failed (old worker still cleaning up), ` +
          `retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.startWorker(id, workerOptions, retryCount + 1);
      }
      
      this.logger.error(`Error starting worker ${id}: ${err}`);
    }
  }

  async shutdownWorker(worker: Worker, force: boolean) {
    const workerId = worker.options.identity;
    
    if (
      worker.getState() === WorkerState.RUNNING ||
      worker.getState() === WorkerState.INITIALIZED
    ) {
      worker.shutdown();
    }

    const runPromise = this.workerRunPromises.get(workerId);
    
    if (!force) {
      while (worker.getState() !== WorkerState.STOPPED) {
        this.logger.log(
          `Waiting for ${worker.options.identity} to be STOPPED. Current state: ${worker.getState()}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.workerStartupTimeout),
        );
      }
    }
    
    if (runPromise) {
      this.logger.debug(`Waiting for ${workerId} run() promise to complete`);
      try {
        await runPromise;
      } catch (err) {
        this.logger.debug(`${workerId} run() promise completed with: ${err.message || 'shutdown'}`);
      }
      this.workerRunPromises.delete(workerId);
      this.logger.debug(`${workerId} fully shut down`);
    }
    
    // remove task queue from taskQueueArr
    this.taskQueuesToMonitor = this.taskQueuesToMonitor.filter(
      (taskQueue) => taskQueue.workerId !== workerId,
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

  /**
   * Refresh Temporal connections with a new JWT token.
   * Called automatically when token is about to expire.
   * 
   * Interval is configurable via JWT_REFRESH_INTERVAL_MINUTES env variable.
   * Default is 1380 minutes (23 hours) for 24-hour token expiry.
   */
  async refreshTemporalConnectionCron(): Promise<void> {
    if (this.isRefreshingConnection) {
      this.logger.warn('[refreshTemporalConnections] - Already refreshing, skipping duplicate request');
      return;
    }    
    this.isRefreshingConnection = true;
    
    try {
      this.logger.warn('[refreshTemporalConnections] - Refreshing connections with new token');
      
      await this.shutdownAllWorkers();
      
      const accessToken = await this.authService.getAccessToken(true);
      this.temporalConfig.metadata = {
        authorization: `Bearer ${accessToken}`,
      };
      const result = await refreshTemporalConnections(
        this.connection,
        this.temporalClientConnection, 
        this.temporalConfig,       
        this.logger,        
      );
      
      this.connection = result.nativeConnection;
      this.temporalClientConnection = result.clientConnection;
      
      this.logger.log('[refreshTemporalConnections] - Refresh complete. Workers will be recreated in next config cycle.');
    } catch (err) {
      this.logger.error(`[refreshTemporalConnections] - Failed: ${err.message}`);
    } finally {
      this.isRefreshingConnection = false;
    }
  }

  /**
   * Gracefully shutdown all active workers.
   * Waits for worker run promises to complete with timeout.
   */
  private async shutdownAllWorkers(): Promise<void> {
    const workerCount = this.activeWorkers.size;
    this.logger.log(`[shutdownAllWorkers] - Shutting down ${workerCount} workers`);
    
    for (const [id, worker] of this.activeWorkers) {
      try {
        if (worker.getState() === WorkerState.RUNNING || worker.getState() === WorkerState.INITIALIZED) {
          this.logger.debug(`[shutdownAllWorkers] - Shutting down worker ${id}`);
          worker.shutdown();
        }
      } catch (err) {
        this.logger.debug(`[shutdownAllWorkers] - Error shutting down worker ${id}: ${err.message}`);
      }
    }
    
    this.logger.debug('[shutdownAllWorkers] - Waiting for worker run promises to complete');
    const runPromises = Array.from(this.workerRunPromises.values());
    await Promise.race([
      Promise.allSettled(runPromises),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    
    // Clear all registries
    this.activeWorkers.clear();
    this.workerRunPromises.clear();
    this.taskQueuesToMonitor = [];
    
    this.logger.log(`[shutdownAllWorkers] - All ${workerCount} workers shut down`);
  }
}
