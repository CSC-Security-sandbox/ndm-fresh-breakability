import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { retry, timer } from 'rxjs';
import { LoggerService } from 'src/logger/logger.service';
import { NativeConnection, Worker } from '@temporalio/worker';
import { WorkerConfiguration } from './work-manager.types';
import { getWorkerIdentity } from 'src/utils/woker-mapager.mappers';

@Injectable()
export class WorkManagerService {

    readonly workerConfigUrl: string
    static loadingConfigs = false;
    readonly workerId: string;
    private connection: NativeConnection = null;
    private workers: Worker[] = [];
    private activeWorkers: Set<string> = new Set<string>()

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(HttpService) private readonly httpService: HttpService,
        @Inject(LoggerService) private readonly logger: LoggerService,
    ) {
        this.workerConfigUrl = `${this.configService.get('worker.workerConfigUrl')}?workerId=${this.configService.get('worker.workerId')}`;
        this.workerId = this.configService.get('workers.workerId');
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
        for(let i = 0; i < configs.length; i++) {
            const id = getWorkerIdentity(configs[i])
            if(!this.activeWorkers.has(id)) {

            }
        }
    }
}
