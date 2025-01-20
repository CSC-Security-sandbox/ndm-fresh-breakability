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
    private workers: Worker[] = [];
    private activeWorkers: Set<string> = new Set<string>()
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
        const activeConfigs: Set<string> = new Set<string>()
        let configsToStart: string[] = []
        for(let i = 0; i < configs.length; i++) {
            const id = getWorkerIdentity(configs[i])
            if(!this.activeWorkers.has(id)) 
                configsToStart.push(id)
        }
        for(let i = 0; i < this.workers.length; i++) {
            const id = this.workers[i].options.identity
            if(!activeConfigs.has(id)) {
                this.logger.info(`Stopping worker ${id}`)
                await this.shutdownWorker(this.workers[i], false)
                this.activeWorkers.delete(id)
                this.workers.splice(i--, 1)
            }
        }
        for(let i = 0; i < configsToStart.length; i++) {
            this.logger.info(`Starting worker ${configsToStart[i]}`)
            this.activeWorkers.add(configsToStart[i])
        }
    }

    async startWorker(workerOptions: any){
        const worker: Worker = await Worker.create(workerOptions);
        this.workers.push(worker);
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
