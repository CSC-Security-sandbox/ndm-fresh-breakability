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
                    console.log(`[SYNC DEBUG] Command fulfilled - sourceErrors: ${result.value.sourceErrors}, targetErrors: ${result.value.targetErrors}`);
                    console.log(`[SYNC DEBUG] Command fulfilled - sourceErrorNumbers: ${JSON.stringify(result.value.sourceErrorNumbers)}, targetErrorNumbers: ${JSON.stringify(result.value.targetErrorNumbers)}`);
                    
                    syncOutput.errors.source.push(...result.value.sourceErrors);
                    syncOutput.errors.target.push(...result.value.targetErrors);
                    
                    // Add error numbers directly from command execution
                    if (result.value.sourceErrorNumbers && result.value.sourceErrorNumbers.length > 0) {
                        syncOutput.errorNumbers.source.push(...result.value.sourceErrorNumbers);
                        console.log(`[SYNC DEBUG] added sourceErrorNumbers: ${JSON.stringify(result.value.sourceErrorNumbers)}`);
                    }
                    
                    if (result.value.targetErrorNumbers && result.value.targetErrorNumbers.length > 0) {
                        syncOutput.errorNumbers.target.push(...result.value.targetErrorNumbers);
                        console.log(`[SYNC DEBUG] added targetErrorNumbers: ${JSON.stringify(result.value.targetErrorNumbers)}`);
                    }
                } else {
                    // Handle rejected promises - treat them as errors (push array of strings)
                    const errors = Array.isArray(result.reason) ? result.reason : [result.reason];
                    errors.forEach((err: any) => {
                        // DEBUG: Log caught error details
                        console.log(`[DEBUG] executeSyncTask - caught error: ${JSON.stringify(err)}`);
                        console.log(`[DEBUG] executeSyncTask - error.code: ${err?.code}`);
                        console.log(`[DEBUG] executeSyncTask - error.errno: ${err?.errno}`);
                        console.log(`[DEBUG] executeSyncTask - error type: ${typeof err}`);
                        
                        if (typeof err === 'object' && err !== null) {
                            // Add error code
                            const errorCode = err?.code || err?.message || JSON.stringify(err) || 'Unknown error';
                            syncOutput.errors.source.push(errorCode);
                            console.log(`[DEBUG] executeSyncTask - added error code: ${errorCode}`);
                            
                            // Add errno if available
                            if (err.errno) {
                                syncOutput.errorNumbers.source.push(err.errno);
                                console.log(`[DEBUG] executeSyncTask - added errno: ${err.errno} (type: ${typeof err.errno})`);
                            } else {
                                console.log(`[DEBUG] executeSyncTask - no errno found in error`);
                            }
                        } else {
                            const errorString = typeof err === 'string' ? err : String(err) || 'Unknown error';
                            syncOutput.errors.source.push(errorString);
                            console.log(`[DEBUG] executeSyncTask - added string error: ${errorString}`);
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
    
        // DEBUG: Log error information to diagnose errno -96 issue
        console.log(`[DEBUG] updateAndReportTaskStatus - errors.source: ${JSON.stringify(errors.source)}`);
        console.log(`[DEBUG] updateAndReportTaskStatus - errorNumbers: ${JSON.stringify(errorNumbers)}`);
        console.log(`[DEBUG] updateAndReportTaskStatus - errorNumbers?.source: ${JSON.stringify(errorNumbers?.source)}`);
        
        const codeBasedFatal = errors.source.some(isSourceFatalError);
        const errnoBasedFatal = errorNumbers?.source && errorNumbers.source.some(isFatalErrno);
        
        console.log(`[DEBUG] updateAndReportTaskStatus - codeBasedFatal: ${codeBasedFatal}`);
        console.log(`[DEBUG] updateAndReportTaskStatus - errnoBasedFatal: ${errnoBasedFatal}`);
        
        const hasFatalSourceError = codeBasedFatal || errnoBasedFatal;
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
