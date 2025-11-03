import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { ScanService } from 'src/activities/core/scan/scan-activity.service';
import { JobRunStatus } from "src/activities/common/enums";
import { updateJobStatusIfNotRunning } from '../common/workflow-utils';
import { ChildScanWorkflowInput, ChildScanWorkflowOutput, ExecuteBatchScanInput, ExecuteBatchScansOutput } from './chid-scan.workflow.type';
import { MappingResolverService } from 'src/activities/core/initializer/mapping-resolver.service';
import { SetupExportsPathPermissionService } from 'src/activities/core/initializer/setup-exports-path-permission.service';
import { dir } from 'console';



const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const {
  createInitialDirBatch: createInitialDirBatchActivity,
} = wf.proxyActivities<CommonTaskService>({ startToCloseTimeout: '10m' });


const {  
  isCmdStreamLenValid: isCmdStreamLenValidActivity,
} = wf.proxyActivities<CommonTaskService>({ 
  startToCloseTimeout: '5m' ,
   retry: {
    maximumAttempts: 3,       // Retry up to 3 times if it fails
    initialInterval: '2s',    // Start with 2 second delay
    backoffCoefficient: 2.0,  // Double the delay each retry
    maximumInterval: '30s',   // Cap retry delay at 30 seconds
    nonRetryableErrorTypes: ['ApplicationFailure'] // Don't retry certain errors
  }  
});

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

const {
  resolveUsernamesToSids: resolveUsernamesToSidsActivity,
} = wf.proxyActivities<MappingResolverService>({
  startToCloseTimeout: '10m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const {
  setupExportPathPermission: setupExportPathPermissionActivity,
} = wf.proxyActivities<SetupExportsPathPermissionService>({
  startToCloseTimeout: '10m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const actionSignal = wf.defineSignal<[JobRunStatus]>('scanActionSignal');


const MAX_CONCURRENT_BATCHES = 20;
const ITERATIONS_LIMIT = 1000;

export const ChildScanWorkflow = async ({ jobRunId, dirsToScan = ['/'], dirBatchIds = [], batchSize = 100, dirCount = 0, fileCount = 0, isMigration = false, actionState = JobRunStatus.Running, isInitialScan = true, workerConcurrency = 20}: ChildScanWorkflowInput): Promise<ChildScanWorkflowOutput> => {

  await updateJobStatusActivity({jobRunId, status :JobRunStatus.Running});

  if(isMigration){
    await resolveUsernamesToSidsActivity(jobRunId);
    await setupExportPathPermissionActivity(jobRunId);
  }

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
  const errors: string[] = [];
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

    let discoverdBatchIds = [];
    for(let i = 0 ; i< dirBatchIds.length;  i+= MAX_CONCURRENT_BATCHES){
      const isCmdLenValid = await validateCommandStreamLength(jobRunId, iterations);
      if(!isCmdLenValid) {
        console.warn(`ChildScanWorkflow ${jobRunId} has exceeded event limit of ${ITERATIONS_LIMIT}, continuing as new`);
        await wf.continueAsNew({
          jobRunId, dirsToScan, dirBatchIds: dirBatchIds, batchSize, dirCount:scanWorkflowOutput.dirCount, fileCount:scanWorkflowOutput.fileCount, isMigration, actionState, isInitialScan: false, workerConcurrency 
        });
      }
      const batchExecResults: ExecuteBatchScansOutput = await executeBatchScan({ batches: dirBatchIds.slice(i, i + MAX_CONCURRENT_BATCHES), batchSize, isMigration, jobRunId});
      scanWorkflowOutput.fileCount += batchExecResults.fileCount;
      scanWorkflowOutput.dirCount += batchExecResults.dirCount;
      discoverdBatchIds = discoverdBatchIds.concat(...batchExecResults.batchDirs);
      if(batchExecResults.error){
        errors.push(batchExecResults.error);
      }
      iterations+= MAX_CONCURRENT_BATCHES;
      if(iterations > ITERATIONS_LIMIT ){
        console.warn(`ChildScanWorkflow ${jobRunId} has exceeded event limit of ${ITERATIONS_LIMIT}, continuing as new`);
        const consolidatedBatchIds = dirBatchIds.slice(i+MAX_CONCURRENT_BATCHES).concat(discoverdBatchIds);
        await wf.continueAsNew({
          jobRunId, dirsToScan, dirBatchIds: consolidatedBatchIds, batchSize, dirCount:scanWorkflowOutput.dirCount, fileCount:scanWorkflowOutput.fileCount, isMigration, actionState, isInitialScan: false, workerConcurrency 
        });
      }
    }
    dirBatchIds = discoverdBatchIds;
  }
  if(errors.length > 0) {
    console.log(`[ERROR]ChildScanWorkflow ${jobRunId} encountered errors: ${errors.join(', ')}`);
    scanWorkflowOutput.error = errors.length > 0 ? errors.join(', ') : undefined;
    scanWorkflowOutput.status = JobRunStatus.Errored;
  }else{
     scanWorkflowOutput.status = isStopRequested ? JobRunStatus.Stopped : JobRunStatus.Completed;
  }
  return  scanWorkflowOutput;
}

async function validateCommandStreamLength(jobRunId: string, iterations: number): Promise<boolean> {
  let checkCount = iterations;
  while(checkCount <= ITERATIONS_LIMIT){
      try{
        const isCmdStreamLenValid = await isCmdStreamLenValidActivity(jobRunId);
        if(isCmdStreamLenValid) return true;
        console.warn(`[WARNING] For jobRunId ${jobRunId}, Waiting for stream to be valid.`);
        await wf.sleep('30s'); // wait before checking again
        checkCount+=2;
      }catch(error){
        console.error(`[ERROR] Error validating command stream length for jobRunId ${jobRunId}: ${error.message}`);
        break;
      }
    }
    return false;
}

export const executeBatchScan = async ({ batchSize, batches, isMigration, jobRunId}: ExecuteBatchScanInput): Promise<ExecuteBatchScansOutput> => {
  const output: ExecuteBatchScansOutput = {
    fileCount: 0,
    dirCount: 0,
    batchDirs: [],
    error: undefined,
  };
  const batchResults = await Promise.all(
    batches.map(async (batchId) => {
        try {
          return await scanDirectories({batchSize, isMigration, jobRunId, batchId: batchId});
        } catch (error) {
          console.log(`[ERROR] Error scanning directories for batch ${batchId}: ${error.message}`);
          throw error;
        }
      })
    );
    for(const result of batchResults){
      output.fileCount += result.fileCount;
      output.dirCount += result.dirCount;
      output.batchDirs.push(...result.batchDirs);
    }
  return output;

}
