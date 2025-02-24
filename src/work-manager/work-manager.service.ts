import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NativeConnection, Worker } from '@temporalio/worker';
import { firstValueFrom, lastValueFrom, retry, timer } from 'rxjs';
import { WorkerConfiguration, WorkerState } from './work-manager.types';
import { getWorkerIdentity } from 'src/utils/worker-manager.mappers';
import { Logger } from 'src/logger/logger.service';
import { KeycloakConfig } from 'src/config/keycloak.config';
import { WorkerOptionsService } from './factory/worker-options.factory.service';


@Injectable()
export class WorkManagerService {

    readonly workerConfigUrl: string
    private loadingConfigs = false;
    readonly workerId: string;
    readonly keycloakConfig: KeycloakConfig;
    readonly tokenRequest: string
    private connection: NativeConnection = null;
    private activeWorkers: Map<string,Worker> = new Map<string, Worker>()
    private readonly workerStartupTimeout: number;
    private accessToken: string | null = null;
    private expiresAt: number = 0; 

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(HttpService) private readonly httpService: HttpService,
        @Inject(Logger) private readonly logger: Logger,
        @Inject(WorkerOptionsService) private readonly workerOptions: WorkerOptionsService,
    ) {

        this.workerConfigUrl = `${this.configService.get('worker.workerConfigUrl')}`;
        this.workerId = this.configService.get('worker.workerId');
        this.workerStartupTimeout = this.configService.get('worker.workerStartupTimeout');
        this.keycloakConfig = this.configService.get<KeycloakConfig>('keycloak');
        const tokenData = new URLSearchParams();
        tokenData.append('client_id', this.workerId);
        tokenData.append('client_secret', this.keycloakConfig.workerSecret);
        tokenData.append('grant_type', 'client_credentials')
        this.tokenRequest = tokenData.toString()
    }
    async onApplicationBootstrap() {
        this.logger.info('[onApplicationBootstrap] - Starting Worker Service');
        try {
            this.connection = await NativeConnection.connect(this.configService.get('temporal'));
        } catch (err) {
            this.logger.error(`Error on setting temporal connection: ${err}`);
            throw err;
        }
    }
    async getAccessToken(): Promise<string | null> {
        const now = Math.floor(Date.now() / 1000); 
        if (this.accessToken && now < this.expiresAt) 
            return this.accessToken;
        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    `${this.keycloakConfig.baseUrl}/realms/${this.keycloakConfig.realm}/protocol/openid-connect/token`,
                    this.tokenRequest,
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                )
            );

            this.accessToken = response.data.access_token;
            this.expiresAt = now + response.data.expires_in - 10; 
            this.logger.log(`Fetched new access token, expires at: ${this.expiresAt}`);
            return this.accessToken;
        } catch (error) {
            this.logger.error(`Failed to obtain access token: ${error.message}`);
            return null;
        }
    }
    
    @Cron(CronExpression.EVERY_10_SECONDS)
    async handleCron() {
        if (this.loadingConfigs) return;
        this.loadingConfigs = true;
        try {
           const accessToken = await this.getAccessToken();
            if (!accessToken) throw new Error('Access token is null');
            const response = await firstValueFrom(
                this.httpService.get(`${this.workerConfigUrl}/config`, {
                  headers: { Authorization: `Bearer ${accessToken}` },
                }).pipe(
                    retry({
                        count: 3,
                        delay: (error, retryCount) => {
                            this.logger.warn(`Retrying (${retryCount}) due to error: ${error.message}`);
                            return timer(1500 * retryCount); 
                        },
                    })
                )
            );
            if (response.status !== 200) {
                throw new Error(`Failed to fetch configurations. Status: ${response.status}`);
            }
            await this.handleConfigurations(response.data);
        } catch (error) {
            this.logger.error(`Error fetching configurations: ${error.message}`);
        } finally {
            this.loadingConfigs = false;
        }
    }
    
    async handleConfigurations(configs: WorkerConfiguration[]) {
        let activeConfigs: Set<string> = new Set<string>()
        let configsToStart: Map<string, WorkerConfiguration> = new Map<string, WorkerConfiguration>()
        for(let i = 0; i < configs.length; i++) {
            const id = getWorkerIdentity(configs[i])
            if(!this.activeWorkers.has(id)) 
                configsToStart.set(id, configs[i])
            activeConfigs.add(id)
        }
        for(let [id, worker] of this.activeWorkers) {
            if(!activeConfigs.has(id)) {
                this.logger.info(`Stopping worker ${id}`)
                await this.shutdownWorker(worker, false)
                this.activeWorkers.delete(id)
                activeConfigs.delete(id)
            }
        }
        for(let [id, config] of configsToStart) {
            this.logger.info(`Starting worker ${id} ${JSON.stringify(config)}`)
            configsToStart.delete(id)
            const workerOptions = this.workerOptions.createWorkerOptions(id, config, this.workerId, this.connection)
            await this.startWorker(id, workerOptions)
        }
    }

    async startWorker(id: string, workerOptions: any){
        try {
        const worker: Worker = await Worker.create(workerOptions);
            this.activeWorkers.set(id,worker);
            if (worker.getState() === WorkerState.INITIALIZED) 
                worker.run();
            while (worker.getState() !== WorkerState.RUNNING) {
                this.logger.debug( `Waiting for ${worker.options.identity} to be RUNNING. Current state: ${worker.getState()}`);
                //sleep 
                await new Promise((resolve) => setTimeout( resolve, this.workerStartupTimeout));
            }
        } catch (err) {
            this.logger.error(err);
        }
    }

    async shutdownWorker(worker: Worker, force: boolean) {
        if (worker.getState() === WorkerState.RUNNING || worker.getState() === WorkerState.INITIALIZED) 
            worker.shutdown();

        if (!force) {
            while (worker.getState() !== WorkerState.STOPPED) {
                this.logger.debug(  `Waiting for ${worker.options.identity} to be STOPPED. Current state: ${worker.getState()}`);
                //sleep
                await new Promise((resolve) => setTimeout( resolve, this.workerStartupTimeout));
            }
        } else {
            setTimeout(() => {
                if (worker.getState() !== WorkerState.STOPPED) 
                    this.logger.debug('Worker did not shutdown');
                else 
                    this.logger.debug('Worker shutdown');
            },  this.workerStartupTimeout);
        }
    }
}