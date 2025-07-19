import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandStatus, ErrorType, JobManagerContext, Task, TaskInfo, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { Context } from '@temporalio/activity';
import { Logger } from "@temporalio/worker";
import { basePrefix, isFatalError, isSourceFatalError } from "src/activities/utils/utils";
import { FatalError, RetryableError, RetryExceededError } from "src/errors/errors.types";
import { RedisService } from "src/redis/redis.service";
import { CommonTaskService } from "../common/common-task.service";
import { CommandExecService } from "./command-execution/command-execution.service";
import { handleSyncTaskUpdateInput, SyncOperationInput, SyncOperationOutput } from "./migrate-sync.types";
import { SyncTaskInput, SyncTaskOutput } from "./sync-activity.type";
import { CommandExecInput, CommandExecOutput } from "./command-execution/command-execution.type";

@Injectable()
export class SyncService {
    readonly workerId: string;
    readonly CHUNK_SIZE: number;
    readonly maxRetryCount: number;
    readonly maxConcurrency: number;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
        private readonly redisService: RedisService,
        private readonly commonTaskService: CommonTaskService,
        readonly commandExecService: CommandExecService
    ) {
        this.workerId = this.configService.get('worker.workerId');
        this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
        this.maxConcurrency = this.configService.get('worker.maxCommandConcurrency') || 100;
    }


     async syncTaskActivity({ jobRunId, taskId }: SyncTaskInput): Promise<SyncTaskOutput> {
        const syncActivityCtx = Context.current();
        const heartBeatInterval = setInterval(() => { syncActivityCtx.heartbeat({});}, 2000);
        let syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};
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
          await this.updateAndReportTaskStatus({ taskHashId: taskId, jobContext, errors: syncOutput.errors, task, retryCount: syncOutput.retryCount });
          syncOutput.status = TaskStatus.COMPLETED;
        } catch (error) {
            if(error instanceof FatalError) throw error;
            this.logger.error(`[${jobRunId}] Error in syncTaskActivity: ${error.message}`, error.stack);        
            throw error;
        } finally {
          clearInterval(heartBeatInterval);
        }
        return syncOutput;
    }


    executeSyncTask = async (taskHashId:string, task: TaskInfo, jobContext: JobManagerContext, ): Promise<SyncTaskOutput> => {
        const syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0, retryCount: 0};
        const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId);
        const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId);
        const errorType = task.retryCount + 1 >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR

        for (const [index, command] of task.commands.entries()) {
            if (command.status === CommandStatus.COMPLETED) continue;

            const scanInput: CommandExecInput = {
                sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
                targetPath: `${baseTargetPrefixPath}${command.fPath}`,
                command,
                jobContext,
                errorType
            };

            const output: CommandExecOutput = await this.commandExecService.executeCommand(scanInput);
            if (output.sourceErrors.length > 0 || output.sourceErrors.length > 0) {
                command.status = CommandStatus.ERROR;
                output.sourceErrors.forEach(error => syncOutput.errors.source.push(error));
                output.sourceErrors.forEach(error => syncOutput.errors.target.push(error));
            } else command.status = CommandStatus.COMPLETED;

            await jobContext.setTask(taskHashId, task);
        }
        return syncOutput
    }

    
    async updateAndReportTaskStatus({ errors, jobContext, taskHashId, task, retryCount }: handleSyncTaskUpdateInput): Promise<void> {
        const allCompleted = task.commands.every(cmd => cmd.status === CommandStatus.COMPLETED);
    
        if (allCompleted) {
          task.status = TaskStatus.COMPLETED;
          await jobContext.publishToTaskStream(task);
          await jobContext.deleteTask(taskHashId);
          return;
        }
    
        const hasFatalSourceError = errors.source.some(isSourceFatalError);
        const hasFatalTargetError = errors.target.some(isFatalError);
        const isFatalErrored = hasFatalSourceError || hasFatalTargetError;
    
        task.status = TaskStatus.ERRORED;
        await jobContext.publishToTaskStream(task);
    
        if (isFatalErrored) {
          await jobContext.deleteTask(taskHashId);
          throw new FatalError(
            `Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`
          );
        }
    
        if (retryCount >= this.maxRetryCount) {
          await jobContext.deleteTask(taskHashId);
          throw new RetryExceededError(
            `Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`
          );
        }
    
        throw new RetryableError(
          `Sync Task Update Failed: ${errors.source.length} source errors and ${errors.target.length} target errors with retry count ${retryCount}`
        );
    }

}