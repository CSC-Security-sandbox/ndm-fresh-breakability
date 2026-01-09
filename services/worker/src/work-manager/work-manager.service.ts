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
import { getLocalIpAddress } from 'src/utils/network.utils';

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
      // First, register with config service to get updated environment variables (including CA cert for TLS)
      this.logger.log('[onApplicationBootstrap] - Registering with config service');
      const updatedEnvVariables = await this.registerAndGetEnvironment();
      
      // Apply critical environment variables to process.env for Temporal config
      if (updatedEnvVariables.TEMPORAL_TLS_CA_CERT) {
        process.env.TEMPORAL_TLS_CA_CERT = updatedEnvVariables.TEMPORAL_TLS_CA_CERT;
        this.logger.log('[onApplicationBootstrap] - Applied TEMPORAL_TLS_CA_CERT from config service');
      }
      
      // Build Temporal configuration dynamically (after env vars are set)
      const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
      const tlsEnabled = process.env.TEMPORAL_TLS_ENABLED === 'true';
      
      const temporalConfig: any = { address };
      
      if (tlsEnabled && process.env.TEMPORAL_TLS_CA_CERT) {
        const caCertBuffer = Buffer.from(process.env.TEMPORAL_TLS_CA_CERT, 'base64');
        this.logger.log(`[onApplicationBootstrap] - TLS certificate loaded: ${caCertBuffer.length} bytes`);
        
        temporalConfig.tls = {
          serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME,
          serverRootCACertificate: caCertBuffer,
        };
      }

      // Add JWT to gRPC metadata if Temporal JWT authentication is enabled
      if (process.env.TEMPORAL_JWT_ENABLED === 'true') {
        this.logger.log('[onApplicationBootstrap] - JWT authentication enabled for Temporal connection');
        try {
          // Fetch access token from Keycloak
          const accessToken = await this.authService.getAccessToken();
          
          // Add JWT to gRPC metadata
          temporalConfig.metadata = {
            authorization: `Bearer ${accessToken}`,
          };
          this.logger.log('[onApplicationBootstrap] - JWT added to Temporal connection metadata');
        } catch (jwtError) {
          this.logger.error(`Failed to obtain JWT for Temporal connection: ${jwtError}`);
          throw new Error('JWT authentication required but token unavailable');
        }
      }

      this.connection = await NativeConnection.connect(temporalConfig);
      this.temporalClientConnection = await Connection.connect(temporalConfig);
    } catch (err) {
      this.logger.error(`Error on setting temporal connection: ${err}`);
      throw err;
    }
  }

  /**
   * Register with config service and retrieve updated environment variables
   * This must be called before connecting to Temporal to get CA certificate for TLS
   */
  private async registerAndGetEnvironment(): Promise<Record<string, any>> {
    this.logger.log('Registering with config-service and fetching environment variables');
    try {
      const accessToken = await this.authService.getAccessToken();
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
            workerIpAddress: workerIp, // Send worker's actual IP
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-client-platform': this.platform,
              'x-worker-ip': workerIp, // Also send in header for backup
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
