
import { JobRunStatus } from 'src/activities/common/enums';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeDiscoveryChildWorkflows } from '../common/execute-discover-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { executeWorkerSetup } from '../common/execute-setup-workflow';
import { executeCleanup } from '../common/execute-cleanup-workflow';



interface DiscoveryWorkflowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}
interface DiscoveryWorkflowOutput {
  traceId: string;
  setupCompletedWorkers:string[];
  failedWorkers:string[];
  fileCount : number;
  dirCount : number;
  status: JobRunStatus;
  excludedPaths?: Array<{ path: string; isDirectory?: boolean; matchedPattern?: string }>;
  skippedPaths?: Array<{ path: string; isDirectory?: boolean }>;
}


export const DiscoveryWorkflow = async ({
  traceId,
  payload,
  options = {},
}: DiscoveryWorkflowInput): Promise<DiscoveryWorkflowOutput> => {
    const output: DiscoveryWorkflowOutput = {
      traceId: traceId,
      setupCompletedWorkers: [],
      dirCount: 0,
      fileCount: 0,
      failedWorkers: [],
      status: JobRunStatus.Ready,
      excludedPaths: [],
      skippedPaths: [],
    };

    // setup workers output
    const setupWorkersExecResult = await executeWorkerSetup({jobRunId: traceId, workerIds: payload.workers, options});
    output.setupCompletedWorkers = setupWorkersExecResult.setupCompletedWorkers;
    output.failedWorkers = setupWorkersExecResult.failedWorkers;


    // validate Redis memory
    await waitUntilRedisMemoryOk(traceId);

    // start core scan workflow
    const discoveryWorkflowExecResult = await executeDiscoveryChildWorkflows({ jobRunId: traceId });
    output.fileCount = discoveryWorkflowExecResult.fileCount;
    output.dirCount = discoveryWorkflowExecResult.dirCount;
    output.status = discoveryWorkflowExecResult.status;
    output.excludedPaths = discoveryWorkflowExecResult.excludedPaths ?? [];
    output.skippedPaths = discoveryWorkflowExecResult.skippedPaths ?? [];

    // Reporting and Report Generation
    await handleReporting(traceId, output.status, {
      excludedPaths: output.excludedPaths,
      skippedPaths: output.skippedPaths,
    });

    // Cleanup
    await executeCleanup({ jobRunId: traceId, workerIds: output.setupCompletedWorkers, options });

    return output
}