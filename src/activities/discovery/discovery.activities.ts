import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'src/logger/logger.service';
import { ConfigService } from '@nestjs/config';
import { Command, JobConfig, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisService } from 'src/redis/redis.service';
import { uuid4 } from '@temporalio/workflow';
import { WorkersConfig } from 'src/config/app.config';
import axios from 'axios';

@Injectable()
export class DiscoveryActivity {
    readonly workerId: string;
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
    ) {
        this.workerId = this.configService.get('worker.workerId');
    }

    async fetchTasks(traceId: string): Promise<any[]> {
        try {
            const batchSize = 50;
            const jobContext = await this.redisService.getJobContext(traceId);
            const tasks = await jobContext.groupReadTasks('consumer-1', batchSize);
            const streamMessages = [];
            for await (const task of tasks) streamMessages.push(task);
            return streamMessages;
        } catch (error) {
            this.logger.error(`[${traceId}] Failed to fetch the task: ${error}`);
            return [];
        }
    }

    async publishTask(traceId: string): Promise<any> {
        this.logger.log(`[${traceId}] Starting publishTask`);
        try {
            const jobContext = await this.redisService.getJobContext(traceId);
            this.logger.log(`[${traceId}] JobContext retrieved. Processing files.`);
            const directoryBatchSize = 2500;
            let counter = 0;
            let commandsBatch: Command[] = [];
            for await (const directory of jobContext.groupReadDirs('consumer-1', directoryBatchSize)) {
                counter++;
                const ops = { 0: { cmd: 'SCAN', status: 'PENDING' } };
                const command = new Command(directory.path, ops, `cmd-${uuid4()}`);
                commandsBatch.push(command);
                if (commandsBatch && commandsBatch.length >= directoryBatchSize) {
                    const task = new Task(
                        uuid4(),
                        traceId,
                        'SCAN',
                        'PENDING',
                        jobContext.jobConfig.workerIds[0],
                        '/',
                        commandsBatch,
                    );
                    const id = await jobContext.appendToTaskList(task);
                    jobContext.tasksInfo.lastId = id;
                    await this.redisService.setJobContext(traceId, jobContext.serialize());
                    commandsBatch = [];
                }
            }
            if (commandsBatch.length > 0) {
                const task = new Task(
                    uuid4(),
                    traceId,
                    'SCAN',
                    'PENDING',
                    jobContext.jobConfig.workerIds[0],
                    '/',
                    commandsBatch,
                );
                const id = await jobContext.appendToTaskList(task);
                jobContext.tasksInfo.lastId = id;
                await this.redisService.setJobContext(traceId, jobContext.serialize());
            }
            return { status: 'success', message: 'Task published successfully' };
        } catch (error) {
            this.logger.error(`[${traceId}] Error in publishing task: ${error.message}`);
            return {
                traceId: traceId,
                status: 'error',
                message: `Failed to publish task for Job run id ${traceId} : ${error}`,
            };
        }
    }

    async discoveryStatusUpdate(traceId: string, status: string): Promise<any> {
        try {
            const workerJobServiceUrl = WorkersConfig.get('workerJobServiceUrl');
            console.log(`[${traceId}] Updating discovery status to ${status}`);
            await axios.patch(`${workerJobServiceUrl}/${traceId}/${status}`);
            console.log(`[${traceId}] Discovery status updated to ${status}`);
            return { 'message': "Discovery Job status updated as completed for job id: " + traceId };
        } catch (error) {
            console.log(`[${traceId}] Failed to update discovery status: ${error}`);
            return { 'message': "Error while updating the satus of the job id : " + traceId };
        }
    }
}