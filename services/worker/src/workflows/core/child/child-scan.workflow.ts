import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { ScanService } from 'src/activities/core/scan/scan-activity.service';
import { JobRunStatus } from "src/activities/common/enums";
import { updateJobStatusIfNotRunning } from '../common/workflow-utils';
import { ChildScanWorkflowInput, ChildScanWorkflowOutput, ExecuteBatchScanInput, ExecuteBatchScansOutput } from './chid-scan.workflow.type';



const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});


const {
  createInitialDirBatch: createInitialDirBatchActivity,
} = wf.proxyActivities<CommonTaskService>({ startToCloseTimeout: '10m' });

const {
    scanDirectories: scanDirectories,
} = wf.proxyActivities<ScanService>({
    retry:{
        maximumAttempts: 3,
        initialInterval: '10s',
        backoffCoefficient: 2.0,
        nonRetryableErrorTypes: ['ActivityFailure','FatalError',],
    },
    startToCloseTimeout: '24h',
    heartbeatTimeout: '2m',
});



const actionSignal = wf.defineSignal<[JobRunStatus]>('scanActionSignal');


const MAX_CONCURRENT_BATCHES = 100;
const ITERATIONS_LIMIT = 1000;

export const ChildScanWorkflow = async ({ jobRunId, dirsToScan = ['/'], dirBatchIds = [], batchSize = 100, dirCount = 0, fileCount = 0, isMigration = false, actionState = JobRunStatus.Running, isInitialScan = true, workerConcurrency = 20}: ChildScanWorkflowInput): Promise<ChildScanWorkflowOutput> => {

  await updateJobStatusActivity({jobRunId, status :JobRunStatus.Running});

  if(isInitialScan)  {
    const id = await createInitialDirBatchActivity({dirsToScan, jobRunId});
    dirBatchIds.push(id);
  }
  
  const scanWorkflowOutput: ChildScanWorkflowOutput = {
    jobRunId,
    fileCount: fileCount,
    dirCount: dirCount,
    status: JobRunStatus.Running,
    error: undefined,
  };

  wf.setHandler(actionSignal, async (action:JobRunStatus)=>{    
    actionState = action;
    console.log(jobRunId, `action signal called with value: ${action}`);
    
    
  });

  let isStopRequested = false;
  let errors: string[] = [];
  let iterations = 0; 

  while(dirBatchIds.length > 0) {   

    if(actionState === JobRunStatus.Stopped) {
      isStopRequested = true
      console.log(`Stopping ChildScanWorkflow ${jobRunId} as requested. ${actionState}`);
      break;
    }

    // wait until the state is paused. 
    await updateJobStatusIfNotRunning(actionState, jobRunId);
    await wf.condition(() => actionState !== JobRunStatus.Paused);

    iterations+= dirBatchIds.length

    const batchExecResults: ExecuteBatchScansOutput = await executeBatchScan({ batches: dirBatchIds, batchSize, isMigration, jobRunId});
    scanWorkflowOutput.fileCount += batchExecResults.fileCount;
    scanWorkflowOutput.dirCount += batchExecResults.dirCount;
    dirBatchIds = batchExecResults.batchDirs;

    if(iterations > ITERATIONS_LIMIT ){
      console.warn(`ChildScanWorkflow ${jobRunId} has exceeded 1000 iterations, stopping to prevent infinite loop.`);                      
      await wf.continueAsNew({ 
        jobRunId, dirsToScan, batchSize, preBatchDirs: dirBatchIds, dirCount:scanWorkflowOutput.dirCount, fileCount:scanWorkflowOutput.fileCount, isMigration, actionState, initialScan: false, workerConcurrency 
      });      
    }
  }

  scanWorkflowOutput.status = isStopRequested ? JobRunStatus.Stopped : JobRunStatus.Completed;
  scanWorkflowOutput.error = errors.length > 0 ? errors.join(', ') : undefined;

  return  scanWorkflowOutput;
}


export const executeBatchScan = async ({ batchSize, batches, isMigration, jobRunId}: ExecuteBatchScanInput): Promise<ExecuteBatchScansOutput> => {
  const output: ExecuteBatchScansOutput = {
    fileCount: 0,
    dirCount: 0,
    batchDirs: [],
    error: undefined,
  };


  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
    const batchSlice = batches.slice(i, i + MAX_CONCURRENT_BATCHES);
    const batchResults = await Promise.all(
      batchSlice.map(async (batchId) => {
        try {
          return await scanDirectories({batchSize, isMigration, jobRunId, batchId: batchId});
        } catch (error) {
          if (error instanceof wf.ActivityFailure) {
            return {
              jobRunId: jobRunId,
              fileCount: 0,
              dirCount: 0,
              subDirs: [],
              error: error.message || 'Activity failed error',
              batchDirs: [],
            };
          }
          throw error;
        }
      })
    );

    for(const result of batchResults){
      output.fileCount += result.fileCount;
      output.dirCount += result.dirCount; 
      output.batchDirs.push(...result.batchDirs);
    }  
  }

  return output;
}
