import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { ScanService } from 'src/activities/core/scan/scan-activity.service';
import { JobRunStatus } from "src/activities/discovery/enums";
import { updateJobStatusIfNotRunning } from '../common/workflow-utils';
import { ChildScanWorkflowInput, ChildScanWorkflowOutput } from './chid-scan.workflow.type';



const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
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



const actionSignal = wf.defineSignal<[string]>('scanActionSignal');


export function createBatches(dirsToScan , batchSize): string[][] {
   const batches: string[][] = [];
    for (let i = 0; i < dirsToScan.length; i += batchSize) {
      batches.push(dirsToScan.slice(i, i + batchSize));
    }
    return batches;
  

}
export const ChildScanWorkflow = async ({ jobRunId, dirsToScan = ['/'], batchSize = 100, dirCount = 0, fileCount = 0, isMigration = false}: ChildScanWorkflowInput): Promise<ChildScanWorkflowOutput> => {
  
  await updateJobStatusActivity({jobRunId, status :JobRunStatus.Running});
  let state:JobRunStatus = JobRunStatus.Running;
  const scanWorkflowOutput: ChildScanWorkflowOutput = {
    jobRunId,
    fileCount: 0,
    dirCount: 0,
    status: JobRunStatus.Running,
    error: undefined,
  };

  wf.setHandler(actionSignal, async (action:string)=>{
    state = action as JobRunStatus;
    console.log(jobRunId, `action signal called with value: ${action}`);
    
  });

  let isStopRequested = false;
  let errors: string[] = [];
  let iterations = 0; 
  while(dirsToScan.length > 0) {    
    iterations++;
    if(state === JobRunStatus.Stopped as JobRunStatus) {
      isStopRequested = true
      break;
    }
    // wait until the staate is paused. 
    await updateJobStatusIfNotRunning(state, jobRunId);
    await wf.condition(() => state !== JobRunStatus.Paused);

    
      
    const batches: string[][] = createBatches(dirsToScan, batchSize);

    let nexDirsToScan: string[] = [];
    //TODO: make workflow failed when activity fails. 
    const results = await Promise.all(
      batches.map(async (dirs) =>{
        try{
            return await scanDirectories({jobRunId, dirsToScan: dirs, isMigration});
        }catch(error){
            if(error instanceof wf.ActivityFailure)  {
              console.error(`Activity failed for jobRunId: ${jobRunId}, dirs: ${dirs}, error: ${error.message}`);
              errors.push(`Activity failed for jobRunId: ${jobRunId}, dirs: ${dirs}, error: ${error.message}`);
             return { jobRunId, fileCount: 0, dirCount: 0, subDirs: [], error: error.message || 'Activity failed error' };
          }
          throw error
          // TODO: handle error
        }
      }));

    for(const result of results){
      scanWorkflowOutput.fileCount += result.fileCount; // Add file count from the result.
      scanWorkflowOutput.dirCount += result.dirCount; // Add directory count from the result.
      console.log(`results : ${JSON.stringify(result.subDirs)}`)
      nexDirsToScan.push(...result.subDirs)
    }        
    dirsToScan = nexDirsToScan;
    nexDirsToScan = []
    if(iterations > 500 ){
      console.warn(`ChildScanWorkflow ${jobRunId} has exceeded 500 iterations, stopping to prevent infinite loop.`);                      
      await wf.continueAsNew({ jobRunId, dirsToScan, batchSize, dirCount, fileCount, isMigration });      
    }
  }

  scanWorkflowOutput.status = isStopRequested ? JobRunStatus.Stopped : JobRunStatus.Completed;
  scanWorkflowOutput.error = errors.length > 0 ? errors.join(', ') : undefined;

  return  scanWorkflowOutput;
}

