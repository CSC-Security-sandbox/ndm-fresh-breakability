import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandStatus, ErrorType, JobManagerContext, TaskInfo, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { ApplicationFailure, Context } from '@temporalio/activity';
import {basePrefix, isFatalErrno, isFatalError, isSourceFatalError} from "src/activities/utils/utils";
import { FatalError, RetryExceededError } from "src/errors/errors.types";
import { RedisService } from "src/redis/redis.service";
import { CommonTaskService } from "../common/common-task.service";
import { CommandExecService } from "./command-execution/command-execution.service";
import { CommandExecInput, CommandExecOutput } from "./command-execution/command-execution.type";

import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { handleSyncTaskUpdateInput, SyncTaskInput, SyncTaskOutput } from "./sync-activity.type";

@Injectable()
export class SyncService {
    readonly workerId: string;
    readonly CHUNK_SIZE: number;
    readonly maxRetryCount: number;
    readonly maxConcurrency: number;
    readonly maxWriteConcurrency: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly redisService: RedisService,
        private readonly commonTaskService: CommonTaskService,
        readonly commandExecService: CommandExecService
        
    ) {
        this.workerId = this.configService.get('worker.workerId');
        this.logger = loggerFactory.create(SyncService.name);
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
        this.maxWriteConcurrency = this.configService.get('worker.maxWriteConcurrency') || 1;
    }


     async syncTaskActivity({ jobRunId, taskId }: SyncTaskInput): Promise<SyncTaskOutput> {
        const syncActivityCtx = Context.current();
        const heartBeatInterval = setInterval(() => { syncActivityCtx.heartbeat({});}, 2000);
        let syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0};
        const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
        let task = undefined;
        try {
          task = await jobContext.getTask(taskId);
          if (!task) {
            this.logger.warn(`[${jobRunId}] No Task Found for taskId: ${taskId}`);
            return syncOutput;
          }
          this.logger.debug(`[${jobRunId}] Found Task => ${task?.id} | status : ${task?.status} | command : ${task?.commands?.length}`);
          task = await this.commonTaskService.ensureTaskValid({ task, jobContext });
          task.status = TaskStatus.RUNNING;
          task.workerId = this.workerId;
          await jobContext.publishToTaskStream(task);
          syncOutput = await this.executeSyncTask(taskId, task, jobContext);
          await this.updateAndReportTaskStatus({ taskHashId: taskId, jobContext, errors: syncOutput.errors, errorNumbers: syncOutput.errorNumbers, task });
          syncOutput.status = TaskStatus.COMPLETED;
        } catch (error) {            
            this.logger.error(`[${jobRunId}] Error in syncTaskActivity: ${error.message}`, error.stack);        
            throw error;
        } finally {
          clearInterval(heartBeatInterval);
        }
        return syncOutput;
    }


    executeSyncTask = async (taskHashId:string, task: TaskInfo, jobContext: JobManagerContext ): Promise<SyncTaskOutput> => {
        const syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, errorNumbers: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0};
        const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
        const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);
        const errorType = ++task.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR

        let offset = 0;
        while (offset < task.commands.length) {
            let slice = task.commands.slice(offset, offset + this.maxWriteConcurrency)
            offset += this.maxWriteConcurrency;
            const filteredCommands = slice.filter(command => command.status !== CommandStatus.COMPLETED);
            const results = await Promise.allSettled(filteredCommands.map(command => {
                const scanInput: CommandExecInput = {
                  sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                  targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                  command,
                  jobContext,
                  errorType
                };
                return this.commandExecService.executeCommand(scanInput);
            }));
            results.forEach((result) => {
                if (result.status === 'fulfilled') {
                    syncOutput.errors.source.push(...result.value.sourceErrors);
                    syncOutput.errors.target.push(...result.value.targetErrors);
                } else {
                    // Handle rejected promises - treat them as errors (push array of strings)
                    const errors = Array.isArray(result.reason) ? result.reason : [result.reason];
                    errors.forEach((err: any) => {
                        if (typeof err === 'object' && err !== null) {
                            // Add error code
                            syncOutput.errors.source.push(err?.code || err?.message || JSON.stringify(err) || 'Unknown error');
                            // Add errno if available
                            if (err.errno) {
                                syncOutput.errorNumbers.source.push(err.errno);
                            }
                        } else {
                            syncOutput.errors.source.push(typeof err === 'string' ? err : String(err) || 'Unknown error');
                        }
                    });
                }
            });
        }
        await jobContext.setTask(taskHashId, task);
        return syncOutput
    }

    async updateAndReportTaskStatus({ errors, errorNumbers, jobContext, taskHashId, task }: handleSyncTaskUpdateInput): Promise<void> {
        const allCompleted = task.commands.every(cmd => cmd.status === CommandStatus.COMPLETED);
    
        if (allCompleted) {
          task.status = TaskStatus.COMPLETED;
          await jobContext.publishToTaskStream(task);
          await jobContext.deleteTask(taskHashId);
          return;
        }
    
        const hasFatalSourceError = errors.source.some(isSourceFatalError) || (errorNumbers?.source && errorNumbers.source.some(isFatalErrno));
        const hasFatalTargetError = errors.target.some(isFatalError);
        const isFatalErrored = hasFatalSourceError || hasFatalTargetError;
    
        task.status = TaskStatus.ERRORED;
        await jobContext.publishToTaskStream(task);
    
        if (isFatalErrored) {
          await jobContext.deleteTask(taskHashId);
            throw new FatalError(
            `Sync Task Update Failed: ${[...new Set(errors.source)].length} source errors: ${[...new Set(errors.source)].join(", ")} and ${[...new Set(errors.target)].length} target errors: ${[...new Set(errors.target)].join(", ")} with retry count ${task.retryCount} `
            );
        }
    
        if (task.retryCount >= this.maxRetryCount) {
          await jobContext.deleteTask(taskHashId);
          throw new RetryExceededError(
            `Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`
          );
        }
    
        throw ApplicationFailure.retryable(
          `Sync Task Update Failed: ${[...new Set(errors.source)].length} source errors: ${[...new Set(errors.source)].join(", ")} and ${[...new Set(errors.target)].length} target errors: ${[...new Set(errors.target)].join(", ")} with retry count ${task.retryCount}`, 
          'RetryableError'
        );
    }

}
