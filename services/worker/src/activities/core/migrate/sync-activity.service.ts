import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandStatus, ErrorType, ItemInfo, JobManagerContext, TaskInfo, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { ApplicationFailure, CancelledFailure, Context } from '@temporalio/activity';
import { basePrefix, isFatalError, isSourceFatalError, isTransientError } from "src/activities/utils/utils";
import { FatalError, METADATA_UPDATE_CONFLICT, RetryExceededError } from "src/errors/errors.types";
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
    const heartBeatInterval = setInterval(() => { syncActivityCtx.heartbeat({}); }, 2000);
    let syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0 };
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
      await this.updateAndReportTaskStatus({ taskHashId: taskId, jobContext, errors: syncOutput.errors, task });
      syncOutput.status = TaskStatus.COMPLETED;
    } catch (error) {
      if (error instanceof CancelledFailure) {
        this.logger.warn(`[${jobRunId}] SyncTaskActivity cancelled for taskId: ${taskId}`);
        throw error;
      }
      this.logger.error(`[${jobRunId}] Error in syncTaskActivity: ${error.message}`, error.stack);
      throw error;
    } finally {
      clearInterval(heartBeatInterval);
    }
    return syncOutput;
  }


  executeSyncTask = async (taskHashId: string, task: TaskInfo, jobContext: JobManagerContext): Promise<SyncTaskOutput> => {
    const syncOutput: SyncTaskOutput = { errors: { source: [], target: [] }, status: TaskStatus.PENDING, error: 0 };
    const baseSourcePrefixPath = basePrefix(task.jobRunId, task.sPathId, jobContext.jobConfig?.sourceDirectoryPath);
    const baseTargetPrefixPath = basePrefix(task.jobRunId, task.tPathId, jobContext.jobConfig?.destinationDirectoryPath);
    const errorType = ++task.retryCount >= this.maxRetryCount ? ErrorType.TRANSIENT_ERROR : ErrorType.RECOVERABLE_ERROR

    let offset = 0;
    while (offset < task.commands.length) {
      if (Context.current().cancellationSignal?.aborted) {
        throw new CancelledFailure('Activity cancelled');
      }
      let slice = task.commands.slice(offset, offset + this.maxWriteConcurrency)
      offset += this.maxWriteConcurrency;
      const filteredCommands = slice.filter(command => command.status !== CommandStatus.COMPLETED);
      const results = await Promise.allSettled(filteredCommands.map( async (command) => {
        const scanInput: CommandExecInput = {
          sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
          targetPath: `${baseTargetPrefixPath}${command.fPath}`,
          command,
          jobContext,
          errorType
        };
        if (!command.isDir) {
          try {
            await jobContext.addInProcessFile(command.fPath, command.metadata?.size ?? null);
          } catch (error: unknown) {
            this.logger.error(`[${task.jobRunId}] Error adding in-process file to redis set: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
          }
        }
        try {
            return await this.commandExecService.executeCommand(scanInput);
        } finally {
            if (!command.isDir) {
              try {
                await jobContext.removeInProcessFile(command.fPath, command.metadata?.size ?? null);
              } catch (error: unknown) {
                this.logger.error(`[${task.jobRunId}] Error removing in-process file from redis set: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
              }
            }
        }
      }));

      // Collect ItemInfo objects and errors from batch results
      const batchItemInfos: ItemInfo[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          syncOutput.errors.source.push(...result.value.sourceErrors);
          syncOutput.errors.target.push(...result.value.targetErrors);
          if (result.value.itemInfo) {
            batchItemInfos.push(result.value.itemInfo);
          }
        } else {
          // Handle rejected promises - treat them as errors (push array of strings)
          const messages: string[] = Array.isArray(result.reason)
            ? result.reason.map((err: any) =>
              typeof err === 'string'
                ? err
                : err?.message || JSON.stringify(err) || 'Unknown error'
            )
            : [result.reason?.message || String(result.reason) || 'Unknown error'];
          syncOutput.errors.source.push(...messages);
        }
      });

      // Bulk publish all ItemInfo objects from this batch in a single Redis call
      if (batchItemInfos.length > 0) {
        await jobContext.publishToFileStreamBulk(batchItemInfos);
      }
    }
    await jobContext.setTask(taskHashId, task);
    return syncOutput
  }

  async updateAndReportTaskStatus({ errors, jobContext, taskHashId, task }: handleSyncTaskUpdateInput): Promise<void> {
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

    // Transient (e.g. E8DOT3) and metadata conflict: no task-level retries (delete + RetryExceeded).
    const isNoRetryCode = (code: string) => isTransientError(code) || code === METADATA_UPDATE_CONFLICT;
    const hasTransientSourceError = errors.source.some(isNoRetryCode);
    const hasTransientTargetError = errors.target.some(isNoRetryCode);
    const hasTransientError = hasTransientSourceError || hasTransientTargetError;

    task.status = TaskStatus.ERRORED;
    await jobContext.publishToTaskStream(task);
    if (isFatalErrored) {
      await jobContext.deleteTask(taskHashId);
      throw new FatalError(
        `Sync Task Update Failed: ${[...new Set(errors.source)].length} source errors: ${[...new Set(errors.source)].join(", ")} and ${[...new Set(errors.target)].length} target errors: ${[...new Set(errors.target)].join(", ")} with retry count ${task.retryCount} `
      );
    }

    if (hasTransientError) {
      await jobContext.deleteTask(taskHashId);
      throw new RetryExceededError(
        `Task ${task.id} contains transient errors that cannot be retried: ${[...new Set([...errors.source, ...errors.target])].join(", ")}`
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
