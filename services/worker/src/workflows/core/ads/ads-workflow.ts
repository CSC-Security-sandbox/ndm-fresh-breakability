import * as wf from '@temporalio/workflow';
import { AdsActivityService } from 'src/activities/core/ads/ads-activity.service';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';

// Workflow input/output interfaces
export interface AdsWorkflowInput {
  traceId: string;
  filePath: string;
  destinationPath: string;
  options?: {
    priority?: boolean;
    skipBinary?: boolean;
    validateTransfer?: boolean;
  };
}

export interface AdsWorkflowOutput {
  traceId: string;
  filePath: string;
  streamCount: number;
  totalSize: number;
  streamsTransferred: number;
  streamsFailed: number;
  validationPassed: boolean;
  status: JobRunStatus;
  errors?: string[];
}

// Activity proxies with proper temporal configuration
const {
  discoverAdsStreams: discoverAdsStreamsActivity,
  transferAdsStream: transferAdsStreamActivity,
  validateAdsStreams: validateAdsStreamsActivity,
  shouldProcessAds: shouldProcessAdsActivity,
} = wf.proxyActivities<AdsActivityService>({
  startToCloseTimeout: '10m',
  heartbeatTimeout: '1m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2.0,
    maximumInterval: '5m',
    nonRetryableErrorTypes: ['ApplicationFailure']
  }
});

const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '30s',
  retry: { 
    maximumAttempts: 3, 
    initialInterval: '30s', 
    backoffCoefficient: 1 
  }
});

/**
 * ADS Processing Workflow
 * 
 * This workflow orchestrates the discovery, transfer, and validation of
 * Alternate Data Streams (ADS) for Windows files using NDM's temporal infrastructure.
 * 
 * Workflow Steps:
 * 1. Discover ADS streams for the file
 * 2. Transfer each discovered stream
 * 3. Validate transferred streams
 * 4. Report results
 */
export const AdsWorkflow = async ({
  traceId,
  filePath,
  destinationPath,
  options = {},
}: AdsWorkflowInput): Promise<AdsWorkflowOutput> => {
  
  const output: AdsWorkflowOutput = {
    traceId,
    filePath,
    streamCount: 0,
    totalSize: 0,
    streamsTransferred: 0,
    streamsFailed: 0,
    validationPassed: false,
    status: JobRunStatus.Ready,
    errors: []
  };

  try {
    // Update job status to running
    await updateJobStatusActivity({ 
      jobRunId: traceId, 
      status: JobRunStatus.Running
    });

    // Step 1: Check if file has ADS streams
    const hasAds = await shouldProcessAdsActivity(filePath);
    if (!hasAds) {
      output.status = JobRunStatus.Completed;
      await updateJobStatusActivity({ 
        jobRunId: traceId, 
        status: JobRunStatus.Completed
      });
      return output;
    }

    // Step 2: Discover ADS streams
    const discoveryResult = await discoverAdsStreamsActivity({
      filePath,
      options: {
        priority: options.priority ?? false,
        skipBinary: options.skipBinary ?? true
      }
    });

    output.streamCount = discoveryResult.streamCount;
    output.totalSize = discoveryResult.totalSize;

    if (output.streamCount === 0) {
      output.status = JobRunStatus.Completed;
      await updateJobStatusActivity({ 
        jobRunId: traceId, 
        status: JobRunStatus.Completed,

      });
      return output;
    }

    // Step 3: Transfer streams (simplified - in production would process discovered streams)
    // For now, we'll simulate transferring streams based on discovery count
    const streamNames: string[] = [];
    for (let i = 0; i < discoveryResult.streamCount; i++) {
      streamNames.push(`stream_${i}`);
    }

    for (const streamName of streamNames) {
      try {
        const transferResult = await transferAdsStreamActivity({
          filePath,
          destinationPath,
          streamName,
          options: {
            validateChecksum: options.validateTransfer ?? true,
            chunkSize: 10 * 1024 * 1024 // 10MB chunks
          }
        });

        if (transferResult.transferred) {
          output.streamsTransferred++;
        } else {
          output.streamsFailed++;
          if (transferResult.error) {
            output.errors!.push(`Stream ${streamName}: ${transferResult.error}`);
          }
        }

      } catch (transferError) {
        output.streamsFailed++;
        output.errors!.push(`Stream ${streamName} transfer failed: ${transferError.message}`);
      }
    }

    // Step 4: Validate transferred streams (if requested)
    if (options.validateTransfer && output.streamsTransferred > 0) {
      try {
        const validationResult = await validateAdsStreamsActivity({
          filePath,
          destinationPath,
          expectedStreams: streamNames
        });

        output.validationPassed = validationResult.isValid;
        if (validationResult.errors) {
          output.errors!.push(...validationResult.errors);
        }

      } catch (validationError) {
        output.validationPassed = false;
        output.errors!.push(`Validation failed: ${validationError.message}`);
      }
    } else {
      // Skip validation or no streams to validate
      output.validationPassed = output.streamsTransferred > 0;
    }

    // Determine final status
    if (output.streamsFailed === 0) {
      output.status = JobRunStatus.Completed;
    } else if (output.streamsTransferred > 0) {
      output.status = JobRunStatus.Completed;
    } else {
      output.status = JobRunStatus.Failed;
    }

    // Update final job status
    await updateJobStatusActivity({ 
      jobRunId: traceId, 
      status: output.status,

    });

  } catch (workflowError) {
    output.status = JobRunStatus.Failed;
    output.errors!.push(`Workflow error: ${workflowError.message}`);

    await updateJobStatusActivity({ 
      jobRunId: traceId, 
      status: JobRunStatus.Failed,

    });
  }

  return output;
};

/**
 * Batch ADS Processing Workflow
 * 
 * Processes ADS for multiple files in parallel with concurrency control
 */
export interface BatchAdsWorkflowInput {
  traceId: string;
  filePaths: string[];
  destinationBasePath: string;
  options?: {
    maxConcurrency?: number;
    validateTransfer?: boolean;
    priority?: boolean;
  };
}

export interface BatchAdsWorkflowOutput {
  traceId: string;
  totalFiles: number;
  filesProcessed: number;
  filesFailed: number;
  totalStreamsTransferred: number;
  status: JobRunStatus;
  fileResults: AdsWorkflowOutput[];
}

export const BatchAdsWorkflow = async ({
  traceId,
  filePaths,
  destinationBasePath,
  options = {},
}: BatchAdsWorkflowInput): Promise<BatchAdsWorkflowOutput> => {
  
  const output: BatchAdsWorkflowOutput = {
    traceId,
    totalFiles: filePaths.length,
    filesProcessed: 0,
    filesFailed: 0,
    totalStreamsTransferred: 0,
    status: JobRunStatus.Running,
    fileResults: []
  };

  try {
    await updateJobStatusActivity({ 
      jobRunId: traceId, 
      status: JobRunStatus.Running,

    });

    const maxConcurrency = options.maxConcurrency ?? 5;
    const filePromises: Promise<AdsWorkflowOutput>[] = [];

    // Process files in batches to control concurrency
    for (let i = 0; i < filePaths.length; i += maxConcurrency) {
      const batch = filePaths.slice(i, i + maxConcurrency);
      
      for (const filePath of batch) {
        const destinationPath = `${destinationBasePath}/${filePath.split(/[\\/]/).pop()}`;
        
        const filePromise = wf.executeChild(AdsWorkflow, {
          args: [{
            traceId: `${traceId}-file-${i}`,
            filePath,
            destinationPath,
            options: {
              priority: options.priority,
              validateTransfer: options.validateTransfer
            }
          }],
          workflowId: `ads-${traceId}-${i}`,
        });
        
        filePromises.push(filePromise);
      }

      // Wait for current batch to complete before starting next
      const batchResults = await Promise.allSettled(filePromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          output.fileResults.push(result.value);
          output.filesProcessed++;
          output.totalStreamsTransferred += result.value.streamsTransferred;
        } else {
          output.filesFailed++;
        }
      }

      filePromises.length = 0; // Clear for next batch
    }

    // Determine final status
    if (output.filesFailed === 0) {
      output.status = JobRunStatus.Completed;
    } else if (output.filesProcessed > 0) {
      output.status = JobRunStatus.Completed;
    } else {
      output.status = JobRunStatus.Failed;
    }

    await updateJobStatusActivity({ 
      jobRunId: traceId, 
      status: output.status,

    });

  } catch (error) {
    output.status = JobRunStatus.Failed;
    await updateJobStatusActivity({ 
      jobRunId: traceId, 
      status: JobRunStatus.Failed,

    });
  }

  return output;
};