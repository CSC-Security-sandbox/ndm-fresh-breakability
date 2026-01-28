import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FailedOperations, RetryBatchInfo } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import axios from "axios";
import * as path from "path";
import { AuthService } from "src/auth/auth.service";
import { RedisService } from "src/redis/redis.service";
import { FatalError } from "src/errors/errors.types";
import { calculateHash } from "src/activities/utils/checksum-utils";
import { basePrefix } from "src/activities/utils/utils";
import { 
  FetchFailedOperationsInput, 
  FetchFailedOperationsOutput,
  RetryScanSettings
} from "src/workflows/core/child/child-retry-scan.workflow.type";

/**
 * Result from the jobs-service API for failed operations
 */
interface FetchFailedOperationsApiResult {
  operations: FailedOperations[];
  nextCursor: string | null;  // null means no more pages
}

/**
 * Activity for fetching failed operations from the jobs-service API.
 * 
 * Responsibilities:
 * 1. Fetch a batch of failed operations using cursor-based pagination
 * 2. Group operations by parent directory
 * 3. Store grouped operations in Redis
 * 4. Return batch IDs for further processing
 */
@Injectable()
export class FetchFailedOperationsActivity {
  private readonly logger: LoggerService;
  private readonly jobsServiceUrl: string;
  private readonly retryFetchBatchSize: number;
  private readonly projectId: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
    private readonly authService: AuthService,
  ) {
    this.logger = loggerFactory.create(FetchFailedOperationsActivity.name);
    this.jobsServiceUrl = this.configService.get<string>('worker.connection.workerJobServiceUrl') || 'http://jobs-service:3000';
    this.retryFetchBatchSize = this.configService.get<number>('worker.retryFetchBatchSize') || 4000;
    this.projectId = this.configService.get<string>('worker.projectId');
  }

  /**
   * Activity method called by Temporal workflow.
   * Fetches a batch of failed operations from the jobs-service API.
   * Groups operations by parent directory and stores them in Redis.
   * 
   * @param input - Contains jobRunId (for cursor) and originalJobRunId (to fetch from)
   * @returns The batch IDs for grouped operations and hasMore flag
   */
  async fetchFailedOperations(input: FetchFailedOperationsInput): Promise<FetchFailedOperationsOutput> {
    return this.execute(input);
  }

  /**
   * Executes the fetch failed operations activity.
   * 
   * @param input - Contains jobRunId (for cursor) and originalJobRunId (to fetch from)
   * @returns The batch IDs for grouped operations and hasMore flag
   */
  private async execute(input: FetchFailedOperationsInput): Promise<FetchFailedOperationsOutput> {
    const { jobRunId, originalJobRunId } = input;
    
    this.logger.debug(`Fetching failed operations for job run ${jobRunId} from original job ${originalJobRunId}`);
    
    try {
      const jobContext = await this.redisService.getJobManagerContext(jobRunId);
      const accessToken = await this.authService.getAccessToken();
      
      if (!accessToken) {
        throw new FatalError('Failed to get access token');
      }

      // Extract settings once - these will be passed to all subsequent activities
      const settings: RetryScanSettings = {
        sourcePrefix: basePrefix(jobRunId, jobContext.jobConfig.sourceFileServer.pathId),
        targetPrefix: basePrefix(jobRunId, jobContext.jobConfig.destinationFileServer.pathId),
        skipFile: jobContext.jobConfig.options?.skipsFilesModifiedInLast ?? '',
        excludePatterns: jobContext.jobConfig.options?.excludeFilePattern
          ? jobContext.jobConfig.options.excludeFilePattern.split(",")
          : [],
        isSMB: jobContext.jobConfig.sourceFileServer.protocols?.some(
          (p: any) => p.type?.toUpperCase() === 'SMB'
        ) ?? false,
      };
      
      // Get current cursor from jobContext (empty string if first batch)
      const cursor = await jobContext.getRetryCursor();
      
      // Fetch batch of failed operations from ORIGINAL job run
      const fetchResult = await this.fetchFromApi(
        originalJobRunId,
        accessToken,
        cursor || undefined
      );
      
      if (fetchResult.operations.length === 0) {
        this.logger.debug(`No more failed operations to process for original job ${originalJobRunId}`);
        return { opsBatchIds: [], hasMore: false, settings };
      }
      
      // Group operations by parent directory
      const groupedOps = this.groupByParentDirectory(fetchResult.operations);
      
      // Store each group in Redis and collect batch IDs
      const opsBatchIds: string[] = [];
      for (const [parentPath, operations] of groupedOps) {
        const batch = new RetryBatchInfo(parentPath, operations);
        const batchId = calculateHash(operations.map(op => op.fPath));
        await jobContext.setRetryBatch(batchId, batch);
        opsBatchIds.push(batchId);
      }
      
      const hasMore = fetchResult.nextCursor !== null;
      
      // Save the new cursor (if there are more pages)
      if (fetchResult.nextCursor) {
        await jobContext.setRetryCursor(fetchResult.nextCursor);
      }
      
      this.logger.debug(
        `Fetched ${fetchResult.operations.length} operations, grouped into ${opsBatchIds.length} batches, hasMore: ${hasMore}`
      );
      
      return { opsBatchIds, hasMore, settings };
    } catch (error) {
      this.logger.error(`Failed to fetch failed operations: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Fetches failed operations from the jobs-service API with cursor-based pagination.
   * 
   * @param jobRunId - The original job run ID to fetch failed operations for
   * @param accessToken - Bearer token for authentication
   * @param cursor - Optional cursor for pagination
   * @returns The fetched operations and pagination info
   * @throws FatalError for API errors (4xx, 5xx) - these should not be retried
   */
  private async fetchFromApi(
    jobRunId: string,
    accessToken: string,
    cursor?: string
  ): Promise<FetchFailedOperationsApiResult> {
    const url = `${this.jobsServiceUrl}/api/v1/job-run/failed-operations`;
    
    try {
      const response = await axios.get(url, {
        params: {
          jobRunId,
          cursor,
          limit: this.retryFetchBatchSize,
        },
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'projectId': this.projectId,
        },
      });
      
      const apiResponse = response.data.data.items;
      const { data: operations, nextCursor } = apiResponse;
      
      this.logger.debug(
        `Fetched ${operations.length} failed operations from API, hasMore: ${nextCursor !== null}`
      );
      
      return { operations, nextCursor };
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
   * Groups failed operations by their parent directory.
   * 
   * @param operations - The failed operations to group
   * @returns Map of parent path to array of operations
   */
  private groupByParentDirectory(operations: FailedOperations[]): Map<string, FailedOperations[]> {
    const opsByParent = new Map<string, FailedOperations[]>();
    
    for (const op of operations) {
      const parentPath = path.dirname(op.fPath);
      if (!opsByParent.has(parentPath)) {
        opsByParent.set(parentPath, []);
      }
      opsByParent.get(parentPath)!.push(op);
    }
    
    return opsByParent;
  }
}
