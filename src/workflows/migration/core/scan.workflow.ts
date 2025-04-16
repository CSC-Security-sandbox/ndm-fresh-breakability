import { ContinueAsNew, continueAsNew, proxyActivities } from "@temporalio/workflow";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrationScanService } from "src/activities/migrate/migrate.scan.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";

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
    updateLastEntry: updateLastEntryActivity
} = wf.proxyActivities<CommonActivityService>({ 
  startToCloseTimeout: '24h', 
 });
   
interface ScanWorkflowInput {
    jobRunId: string;
    workerId: string
}

export const ScanWorkflow = async ({jobRunId } : ScanWorkflowInput): Promise<any> => {
  console.log('Starting MigrateScan ', jobRunId)
  let iteration = 0;
  try {
    await updateStatusActivity({jobRunId, status :JobRunStatus.Running})
    const jobState = await getJobStateActivity(jobRunId)
    const updatedJobState = {...jobState, status: JobRunStatus.Running};
    await setJobStateActivity(jobRunId, updatedJobState)
    while (true) {
      iteration++;

      log(jobRunId,`Iteration number ${iteration} for scan`)
      const jobState = await getJobStateActivity(jobRunId)

      if(jobState.status === JobRunStatus.Stopped) {
        log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
        return { message: 'Scan Stopped' };
      }

      if(jobState.status === JobRunStatus.Paused) {
        log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
        return { message: 'Scan Stopped' };
      }

      const outputs = await Promise.all(
        jobState.workers_agreed.map(async() => { return await scanActivity({ jobRunId })})
      );

      const noTaskFound = outputs.every((output) => output.noTaskFound);
      const isFatalErrored = outputs.every((output) => output.isFatal);
      
      await Promise.all(
        jobState.workers_agreed.map(() => publishTaskActivity({jobRunId}))
      );

      if (noTaskFound) {
        log(jobRunId, `No tasks found.`);
        const currentJobState = await getJobStateActivity(jobRunId);
        await setJobStateActivity(jobRunId, {...currentJobState, isScanCompleted: true})
        return { message: 'Scan Completed' };
      }

      if(isFatalErrored) {
        log(jobRunId, `Fatal Error Occurred On JobRun ${jobRunId}`)
        const currentJobState = await getJobStateActivity(jobRunId);
        const updatedJobState = {...currentJobState, status: JobRunStatus.Errored};
        await setJobStateActivity(jobRunId, updatedJobState)
        return { message: 'Scan Errored' };
      }

      if(iteration >= 100) {
        log(jobRunId, `Iteration limit reached. Continuing as new...`);
        await continueAsNew({ jobRunId });
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
          return { message: `Scan Errored ${error}` };
      }
  }

}
