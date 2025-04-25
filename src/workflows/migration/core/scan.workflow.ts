import { ContinueAsNew, continueAsNew, proxyActivities } from "@temporalio/workflow";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrationScanService } from "src/activities/migrate/migrate.scan.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { ScanPathOutput } from "src/activities/migrate/migrate.type";
import { sleep } from '@temporalio/workflow';

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}

const { scanPath: scanActivity } = proxyActivities<MigrationScanService>({ 
  startToCloseTimeout: '24h', 
 });

const {
    publishScanTask: publishTaskActivity,  
} = proxyActivities<MigrationTaskService>({ 
  startToCloseTimeout: '24h', 
 });

const {
    getJobState: getJobStateActivity,
    updateStatus: updateStatusActivity,
    setJobState: setJobStateActivity,
    updateLastEntry: updateLastEntryActivity,
    getJobStateWithStreamLoad: getJobStateWithStreamLoadActivity,
} = wf.proxyActivities<CommonActivityService>({ 
  startToCloseTimeout: '24h', 
 });
   
interface ScanWorkflowInput {
  jobRunId: string;
  workers: string[];
  failedWorkers: string[];
}

interface ScanWorkflowOutput{
  jobRunId: string;
  workers: string[];
  failedWorkers: string[];
  status: JobRunStatus;
  error?: string;
}

export const syncWorkerListSignal = wf.defineSignal<[string[]]>('syncWorkerList');

export const ScanWorkflow = async ({ jobRunId, workers, failedWorkers } : ScanWorkflowInput): Promise<ScanWorkflowOutput> => {
  console.log('Starting MigrateScan ', jobRunId)
  // signal handler for syncWorkerList
  wf.setHandler(syncWorkerListSignal, (workerList: string[]) => {
    log(jobRunId, `syncWorkerListSignal called with value: ${workerList}`);
    for(const worker of workerList) 
      if (!workers.includes(worker)) 
        workers.push(worker);
  });

  let iteration = 0;
  let waitingTimeSec = 5;
  let backoffCoefficient = 1.5;
  
  try {
    await updateStatusActivity({jobRunId, status :JobRunStatus.Running})
    const jobState = await getJobStateActivity(jobRunId)
    const updatedJobState = {...jobState, status: JobRunStatus.Running};
    await setJobStateActivity(jobRunId, updatedJobState)
    while (true) {
      iteration++;

      log(jobRunId,`Iteration number ${iteration} for scan`)
      const {jobState, isStreamOverloaded} = await getJobStateWithStreamLoadActivity(jobRunId)

      if(jobState.status.toString() === JobRunStatus.Stopped) {
        log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
        return { jobRunId, workers, failedWorkers, status: JobRunStatus.Stopped };
      }

      if(jobState.status.toString() === JobRunStatus.Paused) {
        log(jobRunId, `JobRun ${jobRunId} is Paused. Exiting scan workflow.`);
        return { jobRunId, workers, failedWorkers, status: JobRunStatus.Paused };
      }

      if(isStreamOverloaded) {
        log(jobRunId, `Stream is overloaded. Sleeping ...`);
        await sleep(1000*waitingTimeSec);
        waitingTimeSec = Math.min(waitingTimeSec * backoffCoefficient, 100);
        continue;
      } 

      waitingTimeSec = 5;
      const outputs: ScanPathOutput[] = await Promise.all(
        workers.map(async() => { 
          return await scanActivity({ jobRunId , failedWorkers})
        })
      );
      
       // TODO: handle the offline workers scenario 
      let taskNotFoundCount:number = 0;
      for(const output of outputs) {
        if(!workers.includes(output.workerId)) workers.push(output.workerId);
        if(output.isFatal && !failedWorkers.includes(output.workerId))  {
          failedWorkers.push(output.workerId);
          log(jobRunId, `Worker ${output.workerId} has failed with error: ${output.errors}`);
        }
        if(output.noTaskFound && !failedWorkers.includes(output.workerId)) taskNotFoundCount++;
      }

      await Promise.all(
        workers.map(async () => {
          return await publishTaskActivity({jobRunId})
        })
      );

      if(workers.length === failedWorkers.length) {
        log(jobRunId, `Fatal Error Occurred On JobRun ${jobRunId}`)
        const currentJobState = await getJobStateActivity(jobRunId);
        const updatedJobState = {...currentJobState, status: JobRunStatus.Errored};
        await setJobStateActivity(jobRunId, updatedJobState)
        return { jobRunId, workers, failedWorkers, status: JobRunStatus.Errored };
      }

      if (taskNotFoundCount === (workers.length-failedWorkers.length)) {
        log(jobRunId, `No tasks found.`);
        const currentJobState = await getJobStateActivity(jobRunId);
        await setJobStateActivity(jobRunId, {...currentJobState, isScanCompleted: true})
        return { jobRunId, workers, failedWorkers, status: JobRunStatus.Completed };
      }

      if(iteration >= 100) {
        log(jobRunId, `Iteration limit reached. Continuing as new...`);
        await continueAsNew({ jobRunId, workers, failedWorkers });
      }
    }

  } catch (error) {
      if (error instanceof ContinueAsNew) {
          log(jobRunId, `Workflow continued as new: ${error.message}`);
          throw error; 
        } else {
          await updateStatusActivity({jobRunId, status: JobRunStatus.Failed})
            .then(() => log(jobRunId, ` status updated to Failed`))
            .then(async () => await updateLastEntryActivity(jobRunId))
            .catch((err) => log(jobRunId, `Failed to discovery status: ${err}`));
           return { jobRunId, workers, failedWorkers, status: JobRunStatus.Errored,  error: error?.message };
      }
  }

}
