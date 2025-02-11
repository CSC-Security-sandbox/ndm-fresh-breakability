import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NativeConnection, Worker } from '@temporalio/worker';
import { retry, timer } from 'rxjs';
import { WorkerOptionsFactory } from './factory/worker-options.factory';
import { WorkerConfiguration, WorkerState } from './work-manager.types';
import * as crypto from 'crypto';
import { getWorkerIdentity } from 'src/utils/worker-manager.mappers';
import { Logger } from 'src/logger/logger.service';


@Injectable()
export class WorkManagerService {

    readonly workerConfigUrl: string
    private loadingConfigs = false;
    readonly workerId: string;
    private connection: NativeConnection = null;
    private activeWorkers: Map<string,Worker> = new Map<string, Worker>()
    private readonly workerStartupTimeout: number;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(HttpService) private readonly httpService: HttpService,
        @Inject(Logger) private readonly logger: Logger,
    ) {
        this.workerConfigUrl = `${this.configService.get('worker.workerConfigUrl')}config`;
        console.log('sssssssss->'+this.workerConfigUrl)
        this.workerId = this.configService.get('worker.workerId');
        this.workerStartupTimeout = this.configService.get('worker.workerStartupTimeout')
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

    @Cron(CronExpression.EVERY_5_SECONDS)
    async handleCron() {
        console.log('Called when the current second is 42');
        console.log(`${this.workerConfigUrl} ${this.configService.get('worker.workerName')} ${this.configService.get('worker.projectId')}`);
        if(this.loadingConfigs) return;
        this.loadingConfigs = true
        // Get the worker configuration changes
        this.httpService.get(`${this.workerConfigUrl}`,{
            headers: {
                ['worker-name']: this.configService.get('worker.workerName'),
                ['project-id']: this.configService.get('worker.projectId')
            },
        })
            .pipe(
                retry({
                    count: 3,
                    delay: (error, retryCount) => {
                        this.logger.warn(`Retrying to fetch configurations. Attempt: ${retryCount}`);
                        return timer(2000);
                    },
                }),
            ).subscribe({
                next: async (response) => {
                  if (response.status !== 200) {
                    this.logger.error(`Failed to fetch configurations. Status code: ${response.status}`);
                    return;
                  }
                  await this.handleConfigurations(response.data);
                },
                error: (error) => {
                  this.logger.error(`Failed to fetch configurations: ${error}`);
                },
            });
        this.loadingConfigs = false;
    }
    
    async handleConfigurations(configs: WorkerConfiguration[]) {
        console.log('Configs' + JSON.stringify(configs));
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
            const workerOptions = WorkerOptionsFactory(id, config, this.workerId, this.connection)
            await this.startWorker(id, workerOptions)
            this.activeWorkers.set(id,null); 
        }
    }

    async startWorker(id: string, workerOptions: any){
        console.log('workerOptions---->', workerOptions)
        try {
        const worker: Worker = await Worker.create(workerOptions);
            this.activeWorkers.set(id,worker);
            console.log('worker.getState()---->', worker.getState())
            if (worker.getState() === WorkerState.INITIALIZED) 
                worker.run();
            while (worker.getState() !== WorkerState.RUNNING) {
                this.logger.debug( `Waiting for ${worker.options.identity} to be RUNNING. Current state: ${worker.getState()}`);
                //sleep 
                await new Promise((resolve) => setTimeout( resolve, this.workerStartupTimeout));
            }
        } catch (err) {
            console.log('err---->', err)
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
