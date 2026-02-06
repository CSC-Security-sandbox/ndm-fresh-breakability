import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Context } from '@temporalio/activity';
import { uuid4 } from '@temporalio/workflow';
import { ErrorType, JobManagerContext, Cmd, TaskInfo, TaskStatus, TaskType, CommandStatus } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { RedisService } from "src/redis/redis.service";
import { dmError, removePrefix } from "src/activities/utils/utils";
import { Origin, Operation } from "src/activities/utils/utils.types";
import { isPathExists } from "../utils/utils";
import { CommandGenerationService } from "../shared/command-generation.service";
import { FatalError, RetryableError } from "src/errors/errors.types";
import { 
  ProcessRetryBatchInput, 
  ProcessRetryBatchOutput,
  GroupedOperationsBatch
} from "src/workflows/core/child/child-retry-scan.workflow.type";

const DEFAULT_BATCH_SIZE = 100;

/**
 * Activity for processing retry batches.
 * 
 * Handles two processing modes:
 * - type: 'ops' - Process specific failed operations (no full directory rescan)
 * - type: 'dir' - Full directory scan for discovered subdirectories
 * 
 * Responsibilities:
 * 1. Retrieve batch data from Redis by batch ID
 * 2. Generate and publish commands using CommandGenerationService
 * 3. Collect discovered subdirectories for further scanning
 * 4. Clean up the batch from Redis after processing
 */
@Injectable()
export class ProcessRetryBatchActivity {
  private readonly logger: LoggerService;
  private readonly maxMigrationCommand: number;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly commandGenerationService: CommandGenerationService,
  ) {
    this.logger = loggerFactory.create(ProcessRetryBatchActivity.name);
    this.maxMigrationCommand = this.configService.get<number>('worker.maxMigrationCommand') || 100;
  }

  /**
   * Activity method called by Temporal workflow.
   * Routes to appropriate processing mode based on type.
   *
   * @param input - Contains jobRunId, batchId, type ('ops' | 'dir'), and optional batchSize
   * @returns Batch IDs for discovered subdirectories
   */
  async processRetryBatch(input: ProcessRetryBatchInput): Promise<ProcessRetryBatchOutput> {
    const { type } = input;
    
    if (type === 'ops') {
      return this.processOperationsBatch(input);
    } else {
      return this.processDirectoryBatch(input);
    }
  }

  /**
   * Processes specific failed operations (no full directory rescan).
   * Used when retrying individual failed files from the operation_errors table.
   */
  private async processOperationsBatch(input: ProcessRetryBatchInput): Promise<ProcessRetryBatchOutput> {
    const { jobRunId, batchId, batchSize = DEFAULT_BATCH_SIZE, settings } = input;

    const activityContext = Context.current();
    const heartbeatInterval = setInterval(() => {
      activityContext.heartbeat({});
    }, 2000);

    try {
      this.logger.debug(`Processing ops batch ${batchId} for job ${jobRunId}`);

      const jobContext = await this.redisService.getJobManagerContext(jobRunId);

      // Retrieve grouped operations from Redis
      const batch: GroupedOperationsBatch = await jobContext.getRetryBatch(batchId);
      if (!batch) {
        this.logger.warn(`Ops batch ${batchId} not found in Redis, may have been processed already`);
        return { batchDirs: [] };
      }

      const { parentPath, operations } = batch;

      const { sourcePrefix, targetPrefix, skipFile, excludePatterns } = settings;

      const sourceParentPath = path.join(sourcePrefix, parentPath);
      const targetParentPath = path.join(targetPrefix, parentPath);

      // Create a command for the parent directory with a Task in DB for error tracking
      // Similar to scan - ensures Operation exists before we try to read the directory
      const { command: parentCommand, taskInfo: parentTaskInfo } = await createDirCommandWithTask(parentPath, jobContext, jobRunId);

      let hasErrors = false;

      // Get target directory contents for conflict detection (origin-aware)
      const targetContent = await getDirContents({
        path: targetParentPath,
        origin: Origin.DESTINATION,
        jobContext,
        errorType: ErrorType.TRANSIENT_ERROR,
        command: parentCommand
      });

      // Convert operations to items - process ONLY specific failed files
      const items = operations.map((op) => ({
        name: path.basename(op.fPath),
        fPath: op.fPath,
        originalCommandId: op.id,
      }));

      const result = await this.commandGenerationService.processItems({
        items,
        sourcePath: sourceParentPath,
        targetPath: targetParentPath,
        sourcePrefix,
        targetPrefix,
        jobContext,
        command: parentCommand,  // Pass for error correlation during retry scan
        settings: { skipFile, excludePatterns },
        errorType: ErrorType.TRANSIENT_ERROR,
        targetContent,
        maxCommandsPerBatch: this.maxMigrationCommand,
      });

      if (result.commands.length > 0) {
        await jobContext.publishBulkToCommandStream(result.commands);
        this.logger.debug(`Published ${result.commands.length} commands for batch ${batchId}`);
      }

      // Use batchSubDirsWithTask to create DB entries for discovered subdirectories
      const { batchIds: batchDirs } = await batchSubDirsWithTask(result.subDirs, batchSize, jobContext, jobRunId);

      // Update parent task status to COMPLETED
      await updateTaskStatus(parentTaskInfo, hasErrors, jobContext);

      // Clean up
      await jobContext.deleteRetryBatch(batchId);

      this.logger.debug(
        `Processed ops batch ${batchId}: ${operations.length} ops, ${result.commands.length} commands, ${batchDirs.length} subdir batches`,
      );

      return { batchDirs };
    } catch (error) {
      if (error instanceof FatalError) {
        this.logger.error(`Fatal error processing ops batch ${batchId}: ${error.message}`, error.stack);
        throw error;
      }
      this.logger.error(`Failed to process ops batch ${batchId}: ${error.message}`, error.stack);
      throw new RetryableError(error.message);
    } finally {
      clearInterval(heartbeatInterval);
    }
  }

  /**
   * Performs full directory scans for discovered subdirectories.
   * Used when directories were discovered during retry and need full readdir scanning.
   * 
   * The batch contains Cmd[] objects (from batchSubDirsWithTask) with IDs that already
   * exist as Operations in the database, enabling proper error visibility in UI.
   */
  private async processDirectoryBatch(input: ProcessRetryBatchInput): Promise<ProcessRetryBatchOutput> {
    const { jobRunId, batchId, batchSize = DEFAULT_BATCH_SIZE, settings } = input;
    
    const activityContext = Context.current();
    const heartbeatInterval = setInterval(() => {
      activityContext.heartbeat({});
    }, 2000);
    
    try {
      this.logger.debug(`Scanning directories from batch ${batchId} for job ${jobRunId}`);
      
      const jobContext = await this.redisService.getJobManagerContext(jobRunId);
      
      // Retrieve directory commands from Redis (Cmd[] with IDs, not string[])
      const dirCommands: Cmd[] = await jobContext.getBatchDir(batchId);
      if (!dirCommands || dirCommands.length === 0) {
        this.logger.warn(`Directory batch ${batchId} not found in Redis or empty`);
        return { batchDirs: [] };
      }

      // Retrieve TaskInfo for this batch (created by batchSubDirsWithTask)
      const batchTaskInfo = await jobContext.getTask(`batch-task:${batchId}`);

      const { sourcePrefix, targetPrefix, skipFile, excludePatterns } = settings;
      
      const allSubDirs: string[] = [];
      let hasErrors = false;
      
      for (const command of dirCommands) {
        const relativeDir = command.fPath;
        try {
          const sourceDirPath = path.join(sourcePrefix, relativeDir);
          const targetDirPath = path.join(targetPrefix, relativeDir);
          
          // Get source directory contents (origin-aware with error publishing)
          const sourceContent = await getDirContents({
            path: sourceDirPath,
            origin: Origin.SOURCE,
            jobContext,
            errorType: ErrorType.TRANSIENT_ERROR,
            command
          });
        
          // Get target directory contents (origin-aware)
          const targetContent = await getDirContents({
            path: targetDirPath,
            origin: Origin.DESTINATION,
            jobContext,
            errorType: ErrorType.TRANSIENT_ERROR,
            command
          });
          
          const items = Array.from(sourceContent).map(name => ({ name }));
          
          const result = await this.commandGenerationService.processItems({
            items,
            sourcePath: sourceDirPath,
            targetPath: targetDirPath,
            sourcePrefix,
            targetPrefix,
            jobContext,
            command, // Pass the command for error correlation
            settings: { skipFile, excludePatterns },
            errorType: ErrorType.TRANSIENT_ERROR,
            targetContent,
            maxCommandsPerBatch: this.maxMigrationCommand
          });
          
          if (result.commands.length > 0) {
            await jobContext.publishBulkToCommandStream(result.commands);
          }
          
          allSubDirs.push(...result.subDirs);
          
          this.logger.debug(
            `Scanned retry subdir ${relativeDir}: ${sourceContent.size} items, ${result.subDirs.length} subdirs`
          );
        } catch (error) {
          hasErrors = true;
          if (error instanceof FatalError) {
            this.logger.error(`Fatal error scanning retry subdirectory ${relativeDir}: ${error.message}`, error.stack);
            throw error;
          }
          this.logger.error(`Failed to scan retry subdirectory ${relativeDir}: ${error.message}`, error.stack);
          // Continue with other directories for non-fatal errors
        }
      }
      
      // Use batchSubDirsWithTask to create DB entries for newly discovered subdirectories
      const { batchIds: batchDirs } = await batchSubDirsWithTask(allSubDirs, batchSize, jobContext, jobRunId);

      // Update task status and clean up
      if (batchTaskInfo) {
        await updateTaskStatus(batchTaskInfo, hasErrors, jobContext);
        await jobContext.deleteTask(`batch-task:${batchId}`);
      }
      
      // Clean up batch directory data
      await jobContext.deleteBatchDir(batchId);
      
      this.logger.debug(
        `Processed dir batch ${batchId}: ${dirCommands.length} dirs, ${allSubDirs.length} subdirs discovered, ${batchDirs.length} batches created`
      );
      
      return { batchDirs };
    } catch (error) {
      if (error instanceof FatalError) {
        this.logger.error(`Fatal error scanning directory batch ${batchId}: ${error.message}`, error.stack);
        throw error;
      }
      this.logger.error(`Failed to scan directory batch ${batchId}: ${error.message}`, error.stack);
      throw new RetryableError(error.message);
    } finally {
      clearInterval(heartbeatInterval);
    }
  }
}

// =============================================================================
// Retry Task Helper Functions
// These functions are specific to retry workflow Task lifecycle management
// =============================================================================

/**
 * Calculates a hash from an array of strings.
 * Used for creating unique batch IDs.
 */
const calculateHash = (items: string[]): string => {
  const concatenatedIds = items.join('|');
  return crypto.createHash('sha256').update(concatenatedIds).digest('hex');
};

/**
 * Input for getDirContents with origin-aware error handling.
 */
export interface GetDirContentsInput {
  path: string;
  origin: Origin;
  jobContext: JobManagerContext;
  errorType: ErrorType;
  command: Cmd;
}

/**
 * Gets directory contents from a path with origin-aware error handling.
 * 
 * - For SOURCE: publishes error and returns empty set if path doesn't exist
 * - For DESTINATION: returns empty set if path doesn't exist (no error)
 * - Publishes errors to error stream for visibility in UI
 * 
 * @param input - Contains path, origin, jobContext, errorType, and command
 * @returns Set of filenames in the directory
 */
const getDirContents = async (input: GetDirContentsInput): Promise<Set<string>> => {
  const { path: dirPath, origin, jobContext, errorType, command } = input;
  
  try {
    return new Set<string>(await fs.promises.readdir(dirPath));
  } catch (error) {
    // For destination that doesn't exist - return empty (it will be created)
    if (origin === Origin.DESTINATION && error.code === 'ENOENT') {
      return new Set<string>();
    }
    
    // Publish error for visibility
    const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.id, error, { name: command.fPath, path: dirPath });
    await jobContext.publishToErrorStream(ndmError);
    
    // All directory read errors are fatal - cannot proceed without reading directory contents
    throw new FatalError(`Cannot read ${origin === Origin.DESTINATION ? 'destination' : 'source'} directory: ${dirPath}`);
  }
};

/**
 * Result from batchSubDirsWithTask containing batch IDs and their associated TaskInfo objects.
 */
interface BatchSubDirsWithTaskResult {
  batchIds: string[];
  taskInfos: TaskInfo[];
}

/**
 * Result from createDirCommandWithTask containing the command and its associated TaskInfo.
 */
interface DirCommandWithTaskResult {
  command: Cmd;
  taskInfo: TaskInfo;
}

/**
 * Batches subdirectories into groups, creates Tasks for DB persistence, and stores in Redis.
 * This ensures Operations exist in the database BEFORE processing, enabling error visibility.
 * 
 * For each batch:
 * 1. Creates Cmd objects with UUIDs for each directory
 * 2. Builds and publishes a TaskInfo to task stream → db-writer creates Operations in DB
 * 3. Stores the commands in Redis batch for later processing
 * 4. Stores the TaskInfo in Redis for later status updates
 * 
 * @param subDirs - Array of subdirectory paths to batch
 * @param batchSize - Number of directories per batch
 * @param jobContext - The job context for Redis and stream operations
 * @param jobRunId - The job run ID for the Task
 * @returns Object containing batch IDs and TaskInfo objects for status updates
 */
const batchSubDirsWithTask = async (
  subDirs: string[],
  batchSize: number,
  jobContext: JobManagerContext,
  jobRunId: string
): Promise<BatchSubDirsWithTaskResult> => {
  if (subDirs.length === 0) {
    return { batchIds: [], taskInfos: [] };
  }
  
  const batchIds: string[] = [];
  const taskInfos: TaskInfo[] = [];

  for (let i = 0; i < subDirs.length; i += batchSize) {
    const batchDirs = subDirs.slice(i, i + batchSize);
    
    // Create commands with UUIDs for each directory
    const commands = batchDirs.map(dir => new Cmd(uuid4(), dir, CommandStatus.READY, true, {}));
    
    // Build TaskInfo (not Task) for publishing to task stream
    // db-writer creates Operations in DB with new job_run_id
    const taskInfo = new TaskInfo(
      uuid4(),
      jobRunId,
      TaskType.SCAN,
      TaskStatus.RUNNING,
      jobContext.jobConfig.workerIds[0],
      jobContext.jobConfig.sourceFileServer.pathId,
      commands,
      jobContext.jobConfig.destinationFileServer?.pathId ?? null,
      '',
      0
    );
    await jobContext.publishToTaskStream(taskInfo);
    taskInfos.push(taskInfo);
    
    // Store commands (with IDs) in Redis for later processing
    const batchId = calculateHash(batchDirs);
    batchIds.push(batchId);
    await jobContext.setBatchDir(batchId, commands);
    
    // Store TaskInfo in Redis for later status updates (keyed by batchId)
    await jobContext.setTask(`batch-task:${batchId}`, taskInfo);
  }

  return { batchIds, taskInfos };
};

/**
 * Creates a command for a single directory with a Task in DB for error tracking.
 * Similar to how scan creates Tasks before processing directories.
 * 
 * This ensures an Operation exists in the database BEFORE we attempt to read the directory,
 * so any errors can be properly linked to the operation_id.
 * 
 * @param dirPath - The directory path (relative)
 * @param jobContext - The job context for stream operations
 * @param jobRunId - The job run ID for the Task
 * @returns Object containing the Cmd and TaskInfo for status updates
 */
const createDirCommandWithTask = async (
  dirPath: string,
  jobContext: JobManagerContext,
  jobRunId: string
): Promise<DirCommandWithTaskResult> => {
  // Create command with UUID for the directory
  const command = new Cmd(uuid4(), dirPath, CommandStatus.READY, true, {});
  
  // Build TaskInfo and publish to task stream
  // db-writer creates Operation in DB with command.id as operation.id
  const taskInfo = new TaskInfo(
    uuid4(),
    jobRunId,
    TaskType.SCAN,
    TaskStatus.RUNNING,
    jobContext.jobConfig.workerIds[0],
    jobContext.jobConfig.sourceFileServer.pathId,
    [command],
    jobContext.jobConfig.destinationFileServer?.pathId ?? null,
    '',
    0
  );
  await jobContext.publishToTaskStream(taskInfo);
  
  return { command, taskInfo };
};

/**
 * Updates task status to COMPLETED or ERRORED and publishes to task stream.
 * This notifies db-writer to update the task status in the database.
 * 
 * @param taskInfo - The TaskInfo object to update
 * @param hasErrors - Whether any errors occurred during processing
 * @param jobContext - The job context for stream operations
 */
const updateTaskStatus = async (
  taskInfo: TaskInfo,
  hasErrors: boolean,
  jobContext: JobManagerContext
): Promise<void> => {
  taskInfo.status = hasErrors ? TaskStatus.COMPLETED_WITH_ERROR : TaskStatus.COMPLETED;
  await jobContext.publishToTaskStream(taskInfo);
};
