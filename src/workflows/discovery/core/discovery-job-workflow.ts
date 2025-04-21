import { continueAsNew, ContinueAsNew, proxyActivities } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery.core.activity';
import { DiscoverPathOutput } from 'src/activities/discovery/discovery.type';
import { JobRunStatus } from 'src/activities/discovery/enums';
import * as wf from '@temporalio/workflow';

interface DiscoveryWorkflowInput {
  jobRunId: string;
  workers: string[];
  failedWorkers: string[];
}

interface DiscoveryWorkflowOutput{
  jobRunId: string;
  workers: string[];
  failedWorkers: string[];
  status: JobRunStatus;
  error?: string;
}

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { scanActivity } = proxyActivities<DiscoveryScanActivity>({ 
  startToCloseTimeout: '24h', 
});

const { 
  publishTask: publishTaskActivity,
  discoveryStatusUpdate: updateDiscoveryStatus,
} = proxyActivities<DiscoveryActivity>({ 
  startToCloseTimeout: '24h', 
 });

const { 
  updateLastEntry: updateLastEntry,
  getJobState: getJobStateActivity,
  updateStatus: updateStatusActivity,
  setJobState: setJobStateActivity,
} = proxyActivities<CommonActivityService>({ 
  startToCloseTimeout: '24h', 
 });

 export const syncWorkerListSignal = wf.defineSignal<[string[]]>('syncWorkerList');

export async function DiscoveryJobWorkflow({jobRunId, failedWorkers, workers}: DiscoveryWorkflowInput): Promise<DiscoveryWorkflowOutput> {
  // signal handler for syncWorkerList
  wf.setHandler(syncWorkerListSignal, (workerList: string[]) => {
    log(jobRunId, `syncWorkerListSignal called with value: ${workerList}`);
    for(const worker of workerList) 
    if (!workers.includes(worker)) 
        workers.push(worker);
  });

  let iteration = 0;
  try {
    await updateStatusActivity({jobRunId, status :JobRunStatus.Running})
    const jobState = await getJobStateActivity(jobRunId)
    const updatedJobState = {...jobState, status: JobRunStatus.Running};
    await setJobStateActivity(jobRunId, updatedJobState)
    while (true) {
      iteration++;
      const jobState = await getJobStateActivity(jobRunId);

      log(jobRunId,`Iteration number ${iteration} for scan | status: ${jobState.status} | workers_agreed: ${jobState.workers_agreed} | isScanCompleted: ${jobState?.isScanCompleted} `);

      if(jobState.status === JobRunStatus.Stopped) {
          log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
          return { jobRunId, workers, failedWorkers, status: JobRunStatus.Stopped };
      }
  
      if(jobState.status === JobRunStatus.Paused) {
          log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
          return { jobRunId, workers, failedWorkers, status: JobRunStatus.Paused };
      }
      
      const outputs:DiscoverPathOutput[] = await Promise.all(
        workers.map(
          async() => { 
            return await scanActivity({ jobRunId , failedWorkers})
          })
      );

      // TODO: handle the offline workers 
      let taskNotFoundCount:number = 0;
      for(const output of outputs) {
        if(!workers.includes(output.workerId)) workers.push(output.workerId);
        if(output.isFatalErrored && !failedWorkers.includes(output.workerId)) { 
            failedWorkers.push(output.workerId);
            log(jobRunId, `Worker ${output.workerId} has failed with error: ${output.errors}`);
        }
        if(output.noTaskFound && !failedWorkers.includes(output.workerId)) taskNotFoundCount++;
      } 

      await Promise.all(
        workers.map(
          async() => {
            return await publishTaskActivity(jobRunId)
          })
      );

      const isErrored = (workers.length === failedWorkers.length);
      const isCompleted = (taskNotFoundCount === (workers.length-failedWorkers.length));

      if (isCompleted || isErrored) {
        log(jobRunId, `No tasks found. sending last entry`);
        await updateLastEntry(jobRunId)
        .then(() => log(jobRunId, `status updated to Completed`))
        .catch((err) => log(jobRunId, `Failed to update status: ${err}`));
        const currentJobState = await getJobStateActivity(jobRunId);
        await setJobStateActivity(jobRunId, { ...currentJobState, status: isCompleted ? JobRunStatus.Completed : JobRunStatus.Errored});
        const finalJobState = await getJobStateActivity(jobRunId);
        log(jobRunId, `Sync completed with finalJobState: ${JSON.stringify(finalJobState)}`);
        return { jobRunId, workers, failedWorkers, status: isCompleted ? JobRunStatus.Completed : JobRunStatus.Errored };
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
      await updateDiscoveryStatus(jobRunId, 'FAILED')
        .then(() => log(jobRunId, `Discovery status updated to Failed`))
        .then(async () => await updateLastEntry(jobRunId))
        .catch((err) => log(jobRunId, `Failed to update discovery status: ${err}`));
        return { jobRunId, workers, failedWorkers, status: JobRunStatus.Errored,  error: error?.message };
    }
  }
}
