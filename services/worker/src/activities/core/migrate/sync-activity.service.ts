import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandStatus, ErrorType, ItemInfo, JobManagerContext, OPS_CMD, OPS_STATUS, TaskInfo, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { basePrefix, dmError, isFatalError, isSourceFatalError, isTransientError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError, RetryExceededError } from "src/errors/errors.types";
import { RedisService } from "src/redis/redis.service";
import { CommonTaskService } from "../common/common-task.service";
import { CommandExecService } from "./command-execution/command-execution.service";
import { CommandExecInput } from "./command-execution/command-execution.type";
import { StampMetaService } from "./command-execution/stamp-meta.service";
import { SourceAclError } from "./command-execution/win-opeartions/acl-operation.error";

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
    readonly commandExecService: CommandExecService,
    private readonly stampMetaService: StampMetaService,

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
    const isWindows = process.platform === 'win32';

    let offset = 0;
    while (offset < task.commands.length) {
      let slice = task.commands.slice(offset, offset + this.maxWriteConcurrency)
      offset += this.maxWriteConcurrency;
      const filteredCommands = slice.filter(command => command.status !== CommandStatus.COMPLETED);

      // Build inputs for this batch
      const batchInputs: CommandExecInput[] = filteredCommands.map(command => ({
        sourcePath: `${baseSourcePrefixPath}${command.fPath}`,
        targetPath: `${baseTargetPrefixPath}${command.fPath}`,
        command,
        jobContext,
        errorType,
        deferStamp: isWindows, // On Windows, defer stamp to batch phase
      }));

      // Phase 1: Execute copy operations (stamp deferred on Windows)
      const results = await Promise.allSettled(
        batchInputs.map(input => this.commandExecService.executeCommand(input))
      );

      // Collect outputs and track which inputs need batch stamping
      const batchItemInfos: ItemInfo[] = [];
      const needsBatchStamp: CommandExecInput[] = [];

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          syncOutput.errors.source.push(...result.value.sourceErrors);
          syncOutput.errors.target.push(...result.value.targetErrors);

          // On Windows with deferStamp: collect inputs that need batch stamping.
          // When deferStamp=true, executeCommand does NOT build ItemInfo or set COMPLETED status,
          // so we only collect non-error results that have STAMP_META pending.
          if (isWindows && result.value.sourceErrors.length === 0 && result.value.targetErrors.length === 0) {
            const input = batchInputs[idx];
            if (input.command.ops && input.command.ops[OPS_CMD.STAMP_META] &&
                input.command.ops[OPS_CMD.STAMP_META].status !== OPS_STATUS.COMPLETED) {
              needsBatchStamp.push(input);
            }
          }

          // Collect ItemInfo from non-deferred commands (deletes, non-Windows, etc.)
          if (result.value.itemInfo) {
            batchItemInfos.push(result.value.itemInfo);
          }
        } else {
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

      // Phase 2: Batch stamp on Windows (3 PS calls instead of 4N)
      if (isWindows && needsBatchStamp.length > 0) {
        try {
          const batchStampResults = await this.stampMetaService.stampMetaDataBatch(needsBatchStamp);

          for (const input of needsBatchStamp) {
            const stampResult = batchStampResults.get(input.sourcePath);
            if (stampResult) {
              syncOutput.errors.source.push(...stampResult.sourceErrors);
              syncOutput.errors.target.push(...stampResult.targetErrors);

              const hasStampErrors = stampResult.sourceErrors.length > 0 || stampResult.targetErrors.length > 0;

              // Update command status — this is the final status since copy succeeded in Phase 1
              if (hasStampErrors) {
                input.command.status = CommandStatus.ERROR;
              } else {
                input.command.status = CommandStatus.COMPLETED;
              }

              // Build ItemInfo now that stamping is complete (with correct SID map + status)
              if (stampResult.shouldUpdateItemInfo) {
                input.stampMetaDataStatus = hasStampErrors ? 'failed' : 'success';
                input.copyContentStatus = input.copyContentStatus ?? 'not_applicable';
                try {
                  const itemInfo = await this.commandExecService.buildFileInfo(input);
                  batchItemInfos.push(itemInfo);
                } catch (buildError) {
                  this.logger.error(`Failed to build ItemInfo for ${input.sourcePath}: ${buildError.message}`, buildError.stack);
                }
              }
            } else {
              // No stamp result returned for this input — unexpected, mark as error
              this.logger.error(`No batch stamp result returned for ${input.sourcePath}`);
              input.command.status = CommandStatus.ERROR;

              const err = new Error(`Batch stamp produced no result for ${input.sourcePath}`);
              const dm = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, input.command.id, err, { name: input.command.fPath, path: input.targetPath });
              await jobContext.publishToErrorStream(dm);
              syncOutput.errors.target.push(err.message);
            }
          }
        } catch (error) {
          // Catastrophic batch stamp failure — report per-file errors to UI
          this.logger.error(`Batch stamp failed: ${error.message}`, error.stack);

          for (const input of needsBatchStamp) {
            const origin = error instanceof SourceAclError ? Origin.SOURCE : Origin.DESTINATION;
            const dm = dmError("OPERATION", origin, Operation.STAMP_META, errorType, input.command.id, error, { name: input.command.fPath, path: input.targetPath });
            await jobContext.publishToErrorStream(dm);

            // Mark each command as ERROR so retry picks them up
            input.command.status = CommandStatus.ERROR;
            if (input.command.ops[OPS_CMD.STAMP_META]) {
              input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.ERROR;
            }
          }
          syncOutput.errors.target.push(error.message);
        }
      }

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

    // Check for transient errors (non-retryable but don't cancel activity)
    const hasTransientSourceError = errors.source.some(isTransientError);
    const hasTransientTargetError = errors.target.some(isTransientError);
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
