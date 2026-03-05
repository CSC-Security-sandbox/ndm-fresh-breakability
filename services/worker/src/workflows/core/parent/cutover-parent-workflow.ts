import { JobRunStatus } from 'src/activities/common/enums';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeCleanup } from '../common/execute-cleanup-workflow';
import { executeMigrationChildWorkflows } from '../common/execute-migration-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { executeWorkerSetup } from '../common/execute-setup-workflow';
import { waitForApproval } from '../common/waiting-approval';



interface CutOverWorkflowInput {
  traceId: string;
  payload: {
    workers: string[];
  };
  options?: Record<string, any>; 
}
interface CutOverWorkflowOutput {
  traceId: string;
  setupCompletedWorkers:string[];
  failedWorkers:string[];
  fileCount : number;
  dirCount : number;
  totalSize: number;
  status: JobRunStatus
}


export const CutOverWorkFlow = async ({
  traceId,
  payload,
  options = {},
}: CutOverWorkflowInput): Promise<CutOverWorkflowOutput> => {
    const output: CutOverWorkflowOutput = {
      traceId: traceId,
      setupCompletedWorkers: [],
      dirCount: 0,
      fileCount: 0,
      totalSize: 0,
      failedWorkers: [],
      status: JobRunStatus.Ready,
    };

    // setup workers output
    const setupWorkersExecResult = await executeWorkerSetup({jobRunId: traceId, workerIds: payload.workers, options});
    output.setupCompletedWorkers = setupWorkersExecResult.setupCompletedWorkers;
    output.failedWorkers = setupWorkersExecResult.failedWorkers;


    // validate Redis memory
    await waitUntilRedisMemoryOk(traceId);

    // start core scan workflow
    const discoveryWorkflowExecResult = await executeMigrationChildWorkflows({jobRunId: traceId})
    output.fileCount = discoveryWorkflowExecResult.fileCount;
    output.dirCount = discoveryWorkflowExecResult.dirCount;
    output.totalSize = discoveryWorkflowExecResult.totalSize;
    output.status = discoveryWorkflowExecResult.status;


    // Reporting and Report Generation
    await handleReporting(traceId, output.status, {
      fileCount: output.fileCount,
      dirCount: output.dirCount,
      totalSize: output.totalSize.toString(),
    });


    // Waiting for approval  
    await waitForApproval(traceId)
    // Cleanup
    await executeCleanup({ jobRunId: traceId, workerIds: output.setupCompletedWorkers, options });

    return output
}