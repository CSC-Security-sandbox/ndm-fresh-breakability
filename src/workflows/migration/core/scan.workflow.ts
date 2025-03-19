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
    fetchScanTask: fetchTaskActivity
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

export const ScanWorkflow = async ({jobRunId , workerId } : ScanWorkflowInput): Promise<any> => {
  console.log('Starting MigrateScan ', jobRunId)
  let iteration = 0;
  try {
    await updateStatusActivity({jobRunId, status :JobRunStatus.Running})
    while (true) {
      iteration++;

      log(jobRunId,`Iteration number ${iteration} for scan`)
      const jobState = await getJobStateActivity(jobRunId);
      if(jobState.status !== JobRunStatus.Running) {
        return { message: `Job status changed to ${jobState.status}` };
      }
      
      const { isFatal, noTaskFound } = await scanActivity({ jobRunId: jobRunId });

      await publishTaskActivity({jobRunId})

      if (noTaskFound) {
        log(jobRunId, `No tasks found.`);
        return { message: 'Scan Completed' };
      }

      if(isFatal) {
        log(jobRunId, `Fatal Error Occurred On worker ${workerId}`)
        const updatedJobState = {...jobState, failedWorkers: [...jobState.failedWorkers, workerId]}
        await setJobStateActivity(jobRunId, updatedJobState);
        break
      }

      if(iteration >= 80) {
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
