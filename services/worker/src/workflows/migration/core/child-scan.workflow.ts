import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrateScanService } from "src/activities/migrate/core/migrate-scan.service";
import { ChildScanWorkflowInput } from "./chid-scan.workflow.type";
import { FatalError, RetryableError, RetryExceededError } from 'src/errors/errors.types';


const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});

const {
    scanDirectories: scanDirectories,
} = wf.proxyActivities<MigrateScanService>({
    retry:{
        maximumAttempts: 3,
        initialInterval: '10s',
        backoffCoefficient: 2.0,
        nonRetryableErrorTypes: ['ActivityFailure','FatalError',],
    },
    startToCloseTimeout: '24h',
    heartbeatTimeout: '2m',
});


interface ScanWorkflowOutput{
  jobRunId: string;
  status: JobRunStatus;
  fileCount : number;
  dirCount : number;
  error?: string;
}

export const ChildScanWorkflow = async ({ jobRunId, dirsToScan = ['/'], batchSize = 100, dirCount = 0, fileCount = 0}: ChildScanWorkflowInput): Promise<ScanWorkflowOutput> => {
  
  await updateJobStatusActivity({jobRunId, status :JobRunStatus.Running});

  const scanWorkflowOutput: ScanWorkflowOutput = {
    jobRunId,
    fileCount: 0,
    dirCount: 0,
    status: JobRunStatus.Running,
    error: undefined,
  };

  // TODO: move this to a seperate activity. 
  // const jobState = await getJobStateActivity( jobRunId );
  // const updatedJobState = {...jobState, status: JobRunStatus.Running};
  // await setJobStateActivity(jobRunId, updatedJobState) 


  let errors: string[] = [];
  while(dirsToScan.length > 0) {
    const batches: string[][] = [];
    for (let i = 0; i < dirsToScan.length; i += batchSize) {
      batches.push(dirsToScan.slice(i, i + batchSize));
    }

    let nexDirsToScan: string[] = [];
    //TODO: make workflow failed when activity fails. 
    const results = await Promise.all(
      batches.map(async (dirs) =>{
        try{
            return await scanDirectories({jobRunId, dirsToScan: dirs});
        }catch(error){
            wf.log.error(`Error scanning directories: ${error}`);
            errors.push(error.message || 'Activity failed error');
             if(error instanceof FatalError || error instanceof RetryExceededError) { 
                console.error(`FatalError occurred for taskId: ${jobRunId} with error: ${error.message}`);
                //TODO: add activity to shutdown the worker with workerId. 
                throw wf.ApplicationFailure.nonRetryable(error.message);
              }
              // if
            if(error instanceof RetryableError) {
                console.error(`RetryableError occurred for taskId: ${jobRunId} with error: ${error.message}`);                        
                throw wf.ApplicationFailure.retryable(error.message);
            }
            return { jobRunId, fileCount: 0, dirCount: 0, subDirs: [], error: error.message || 'Activity failed error' };
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
  }
  scanWorkflowOutput.status = JobRunStatus.Completed;
  scanWorkflowOutput.error = errors.length > 0 ? errors.join(', ') : undefined;
  return  scanWorkflowOutput;
}

