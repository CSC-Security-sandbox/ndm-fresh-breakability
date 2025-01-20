import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { retry, timer } from 'rxjs';
import { LoggerService } from 'src/logger/logger.service';
import { NativeConnection, Worker, State } from '@temporalio/worker';
import { WorkerConfiguration, WorkerState } from './work-manager.types';
import { getWorkerIdentity } from 'src/utils/woker-mapager.mappers';

@Injectable()
export class WorkManagerService {

    readonly workerConfigUrl: string
    static loadingConfigs = false;
    readonly workerId: string;
    private connection: NativeConnection = null;
    private activeWorkers: Map<string,Worker> = new Map<string, Worker>()
    private readonly workerStartupTimeout: number;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(HttpService) private readonly httpService: HttpService,
        @Inject(LoggerService) private readonly logger: LoggerService,
    ) {
        this.workerConfigUrl = `${this.configService.get('worker.workerConfigUrl')}?workerId=${this.configService.get('worker.workerId')}`;
        this.workerId = this.configService.get('workers.workerId');
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

    @Cron(CronExpression.EVERY_SECOND)
    async handleCron() {
        if(WorkManagerService.loadingConfigs) return;
        // Get the worker configuration changes
        this.httpService.get(this.workerConfigUrl)
            .pipe(
                retry({
                    count: 3,
                    delay: (error, retryCount) => {
                        this.logger.warn(
                        `Retrying to fetch configurations. Attempt: ${retryCount}`,
                        );
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
    }
    
    async handleConfigurations(configs: WorkerConfiguration[]) {
        let activeConfigs: Set<string> = new Set<string>()
        let configsToStart: string[] = []
        for(let i = 0; i < configs.length; i++) {
            const id = getWorkerIdentity(configs[i])
            if(!this.activeWorkers.has(id)) 
                configsToStart.push(id)
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
        for(let i = 0; i < configsToStart.length; i++) {
            this.logger.info(`Starting worker ${configsToStart[i]}`)
            this.activeWorkers.set(configsToStart[i], null)
        }
    }

    async startWorker(id: string, workerOptions: any){
        const worker: Worker = await Worker.create(workerOptions);
        this.activeWorkers.set(id,worker);
        try {
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
