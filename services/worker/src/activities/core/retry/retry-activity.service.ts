import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { RedisService } from "src/redis/redis.service";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { AuthService } from "src/auth/auth.service";
import { basePrefix } from "src/activities/utils/utils";
import { 
  FetchRetryBatchInput, 
  FetchRetryBatchOutput
} from "src/workflows/core/child/child-retry-scan.workflow.type";
import { isPathExists } from "../utils/utils";
import { CommandGenerationService } from "../shared/command-generation.service";
import { FatalError } from "src/errors/errors.types";

/**
 * Failed operation data from operation_errors table.
 * Contains the file path and operation ID needed for retry.
 */
interface FailedOperation {
  id: string;       // operation_id from operation_errors (for error reporting)
  fPath: string;    // file_path from operation_errors (path to retry)
}

interface FetchFailedOperationsResult {
  operations: FailedOperation[];
  nextCursor: string | null;  // null means no more pages
}

@Injectable()
export class RetryActivityService {
  private readonly logger: LoggerService;
  private readonly jobsServiceUrl: string;
  private readonly batchSize: number;
  private readonly projectId: string;
  private readonly maxMigrationCommand: number;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly authService: AuthService,
    private readonly commandGenerationService: CommandGenerationService,
  ) {
    this.logger = loggerFactory.create(RetryActivityService.name);
    this.jobsServiceUrl = this.configService.get<string>('worker.connection.workerJobServiceUrl') || 'http://jobs-service:3000';
    this.batchSize = this.configService.get<number>('worker.retryBatchSize') || 50;
    this.projectId = this.configService.get<string>('worker.projectId');
    this.maxMigrationCommand = this.configService.get<number>('worker.maxMigrationCommand') || 100;
  }

  /**
   * Gets directory contents from the target path.
   * Returns empty set if directory doesn't exist (no conflict possible).
   */
  private async getDirContents(dirPath: string): Promise<Set<string>> {
    try {
      const pathExists = await isPathExists(dirPath);
      if (!pathExists) {
        return new Set<string>();
      }
      return new Set<string>(await fs.promises.readdir(dirPath));
    } catch (error) {
      this.logger.debug(`Failed to read directory ${dirPath}: ${error.message}`);
      return new Set<string>();
    }
  }

  /**
   * Fetches failed operations from the jobs-service API with cursor-based pagination.
   * 
   * @param jobRunId - The job run ID to fetch failed operations for
   * @param accessToken - Bearer token for authentication
   * @param cursor - Optional cursor for pagination (last operationErrorId from previous page)
   * @returns The fetched file paths and pagination info
   * @throws FatalError for API errors (4xx, 5xx) - these should not be retried
   */
  private async fetchFailedOperations(
    jobRunId: string,
    accessToken: string,
    cursor?: string
  ): Promise<FetchFailedOperationsResult> {
    const url = `${this.jobsServiceUrl}/api/v1/job-run/failed-operations`;
    
    try {
      const response = await axios.get(
        url,
        {
          params: {
            jobRunId,
            cursor,
            limit: this.batchSize,
          },
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'projectId': this.projectId,
          },
        }
      );
      
      const apiResponse = response.data.data.items; 
      const { data: operations, nextCursor } = apiResponse;
      
      this.logger.debug(
        `Fetched ${operations.length} failed operations, hasMore: ${nextCursor !== null}`
      );
      
      return {
        operations,
        nextCursor,
      };
    } catch (error) {
      // Handle axios errors - throw FatalError for API/DB errors (non-retryable)
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;
        
        // 4xx and 5xx errors are non-retryable (API/DB issues)
        if (status && status >= 400) {
          this.logger.error(`API error fetching failed operations: status=${status}, message=${message}`);
          throw new FatalError(`Failed to fetch failed operations: HTTP ${status} - ${message}`);
        }
      }
      
      // Network errors or other unexpected errors - also treat as fatal
      this.logger.error(`Error fetching failed operations: ${error.message}`);
      throw new FatalError(`Failed to fetch failed operations: ${error.message}`);
    }
  }

  /**
   * Processes items in a directory and publishes commands.
   * Shared logic used by both initial retry processing and recursive subdirectory scanning.
   * 
   * @returns Array of subdirectories that need to be scanned
   */
  private async processDirectoryItems(
    items: Array<{ name: string; fPath?: string; originalCommandId?: string }>,
    sourcePath: string,
    targetPath: string,
    sourcePrefix: string,
    targetPrefix: string,
    jobContext: JobManagerContext,
    settings: { skipFile: string; excludePatterns: string[] }
  ): Promise<string[]> {
    const targetContent = await this.getDirContents(targetPath);

    const result = await this.commandGenerationService.processItems({
      items,
      sourcePath,
      targetPath,
      sourcePrefix,
      targetPrefix,
      jobContext,
      settings,
      errorType: ErrorType.TRANSIENT_ERROR,
      targetContent,
      maxCommandsPerBatch: this.maxMigrationCommand
    });

    if (result.commands.length > 0) {
      await jobContext.publishBulkToCommandStream(result.commands);
    }

    return result.subDirs;
  }

  /**
   * Generates Cmd objects from failed operations using the shared CommandGenerationService.
   * Re-stats source files and performs full validation including:
   * - Exclude patterns and skip time checks
   * - SMB case conflicts and trailing spaces
   * - Volume mount point and junction/symlink detection
   * 
   * For directories, triggers a recursive scan of the directory contents since
   * the original scan may have failed before discovering nested items.
   * 
   * Operations are already sorted by parent directory from the query,
   * so we process them sequentially and only fetch targetContent when
   * the parent directory changes.
   */
  private async generateAndPublishCommands(
    operations: FailedOperation[],
    excludePatterns: string[],
    jobContext: JobManagerContext,
    jobRunId: string
  ): Promise<void> {
    const targetPrefix = basePrefix(jobRunId, jobContext.jobConfig.destinationFileServer.pathId);
    const sourcePrefix = basePrefix(jobRunId, jobContext.jobConfig.sourceFileServer.pathId);
    const skipTime = jobContext.jobConfig.options?.skipsFilesModifiedInLast ?? '';
    const settings = { skipFile: skipTime, excludePatterns };

    // Group operations by parent directory using a Map
    const opsByParent = new Map<string, FailedOperation[]>();
    for (const op of operations) {
      const parentPath = path.dirname(op.fPath);
      if (!opsByParent.has(parentPath)) {
        opsByParent.set(parentPath, []);
      }
      opsByParent.get(parentPath)!.push(op);
    }

    // Collect all subdirectories to scan
    const allSubDirs: string[] = [];

    // Process each directory group
    for (const [parentPath, ops] of opsByParent) {
      const targetParentPath = path.join(targetPrefix, parentPath);
      const sourceParentPath = path.join(sourcePrefix, parentPath);

      const subDirs = await this.processDirectoryItems(
        ops.map(op => ({
          name: path.basename(op.fPath),
          fPath: op.fPath,
          originalCommandId: op.id
        })),
        sourceParentPath,
        targetParentPath,
        sourcePrefix,
        targetPrefix,
        jobContext,
        settings
      );

      allSubDirs.push(...subDirs);
    }

    // Recursively scan all discovered subdirectories
    // This handles the case where a directory failed during initial scan
    // and its contents were never discovered
    if (allSubDirs.length > 0) {
      await this.scanSubDirectories(allSubDirs, sourcePrefix, targetPrefix, jobContext, settings);
    }
  }

  /**
   * Recursively scans subdirectories discovered during retry.
   * This ensures that when a directory that previously failed is retried,
   * all its nested contents are also discovered and commands generated.
   */
  private async scanSubDirectories(
    subDirs: string[],
    sourcePrefix: string,
    targetPrefix: string,
    jobContext: JobManagerContext,
    settings: { skipFile: string; excludePatterns: string[] }
  ): Promise<void> {
    const dirsToProcess = [...subDirs];

    while (dirsToProcess.length > 0) {
      const relativeDir = dirsToProcess.shift()!;
      const sourceDirPath = path.join(sourcePrefix, relativeDir);
      const targetDirPath = path.join(targetPrefix, relativeDir);

      try {
        // Check if source directory still exists
        const sourceExists = await isPathExists(sourceDirPath);
        if (!sourceExists) {
          this.logger.debug(`Source directory no longer exists: ${sourceDirPath}`);
          continue;
        }

        // Read source directory contents and process
        const sourceContent = await fs.promises.readdir(sourceDirPath);
        const newSubDirs = await this.processDirectoryItems(
          sourceContent.map(name => ({ name })),
          sourceDirPath,
          targetDirPath,
          sourcePrefix,
          targetPrefix,
          jobContext,
          settings
        );

        // Add discovered subdirectories to the queue
        dirsToProcess.push(...newSubDirs);

        this.logger.debug(
          `Scanned retry subdir ${relativeDir}: ${sourceContent.length} items, ${newSubDirs.length} subdirs queued`
        );
      } catch (error) {
        this.logger.error(`Failed to scan retry subdirectory ${relativeDir}: ${error.message}`, error.stack);
        // Continue with other directories - don't fail the entire retry batch
      }
    }
  }

  /**
   * Fetches a single batch of failed operations and publishes them to the Redis stream.
   * This is called by the ChildRetryScanWorkflow in a loop.
   * 
   * The activity:
   * 1. Gets the current cursor from Redis (or uses INITIAL_RETRY_CURSOR)
   * 2. Fetches one batch of failed operations from the API (using originalJobRunId)
   * 3. Generates Cmd objects from the operations
   * 4. Publishes commands to the Redis stream (using jobRunId context)
   * 5. Saves the new cursor to Redis
   * 6. Returns whether there are more batches to process
   * 
   * @param input - Contains jobRunId (new retry run) and originalJobRunId (source of failed ops)
   * @returns The batch processing result with counts and hasMore flag
   */
  async fetchRetryBatch(input: FetchRetryBatchInput): Promise<FetchRetryBatchOutput> {
    const { jobRunId, originalJobRunId } = input;
    
    this.logger.debug(`Fetching retry batch for job run ${jobRunId} from original job ${originalJobRunId}`);
    
    try {
      //check if job context
      const jobContext = await this.redisService.getJobManagerContext(jobRunId)
      const accessToken = await this.authService.getAccessToken();
      
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }
      
      // Step 1: Get current cursor from jobContext (empty string if first batch)
      const cursor = await jobContext.getRetryCursor();
      
      // Step 2: Fetch one batch of failed operations from ORIGINAL job run
      const fetchResult = await this.fetchFailedOperations(
        originalJobRunId,
        accessToken,
        cursor || undefined  // Pass undefined to API if empty string
      );
      
      if (fetchResult.operations.length === 0) {
        this.logger.debug(`No more failed operations to process for original job ${originalJobRunId}`);
        return { hasMore: false };
      }
      
      // Get exclude patterns from job config
      const excludePatterns = jobContext.jobConfig.options?.excludeFilePattern
        ? jobContext.jobConfig.options.excludeFilePattern.split(",").map(p => p.trim()).filter(p => p.length > 0)
        : [];
      
      // Step 3: Generate and publish commands from operations (respecting exclude patterns and SMB validations)
      // Commands are published immediately after each directory batch
      await this.generateAndPublishCommands(
        fetchResult.operations,
        excludePatterns,
        jobContext,
        jobRunId
      );
   
      const hasMore = fetchResult.nextCursor !== null;

      // Step 4: Save the new cursor (if there are more pages)
      if (fetchResult.nextCursor) {
        await jobContext.setRetryCursor(fetchResult.nextCursor);
      }
      
      this.logger.debug(
        `Processed batch of ${fetchResult.operations.length} operations, hasMore: ${hasMore}`
      );
      
      return { hasMore };
    } catch (error) {
      this.logger.error(
        `Failed to fetch retry batch: ${error.message}`,
        error.stack
      );
      throw new Error(`fetchRetryBatch activity failed: ${error.message}`);
    }
  }

}
