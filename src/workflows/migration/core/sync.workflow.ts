import * as wf from '@temporalio/workflow';
import { ContinueAsNew, continueAsNew, proxyActivities } from "@temporalio/workflow";
import { CommonActivityService } from "src/activities/common/common.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";



const {
    syncTask: SyncContentActivity
} = proxyActivities<MigrationSyncService>({ startToCloseTimeout: '5h' });


const {
    updateStatus: updateStatusActivity,
    updateLastEntry: updateLastEntryActivity,
    getJobState: getJobStateActivity,
    setJobState: setJobStateActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });
  

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}

export const SyncWorkflow = async ({jobRunId, workerId } : {jobRunId: string, workerId: string}) => {
    console.log('Starting SyncWorkflow ', jobRunId)
    let iteration = 0;
    try {
        while (true) {
            iteration++;
            const jobState = await getJobStateActivity(jobRunId);
            log(jobRunId,`Iteration number ${iteration} for sync jobState = ${JSON.stringify(jobState)}`)
            if(jobState.status !== JobRunStatus.Running) {
              return { message: `Job status changed to ${jobState.status}` };
            }

            const { isFatal, noTaskFound } = await SyncContentActivity({jobRunId})

            if (noTaskFound) {
                const jobState = await getJobStateActivity(jobRunId);
                log(jobRunId,`Iteration number when noTaskFound ${iteration} for sync jobState = ${JSON.stringify(jobState)}`)
                const uniqueAgreedWorkers = jobState.workers_agreed.includes(workerId) ? jobState.workers_agreed : [...jobState.workers_agreed, workerId];
                const newJobState = { ...jobState, workers_agreed: uniqueAgreedWorkers };
                await setJobStateActivity(jobRunId, newJobState);
                const isJobCompleted = newJobState.workers_agreed.length === newJobState.workers.length;
                if (!isJobCompleted) continue 
                log(jobRunId, `No tasks found. sending last entry`);
                await updateLastEntryActivity(jobRunId)
                .then(() => log(jobRunId, `status updated to Completed`))
                .catch((err) => log(jobRunId, `Failed to update status: ${err}`));
                await setJobStateActivity(jobRunId, { ...newJobState, status:  JobRunStatus.Completed });
                const finalJobState = await getJobStateActivity(jobRunId);
                log(jobRunId, `Discovery completed with finalJobState: ${JSON.stringify(finalJobState)}`);
                return { message: 'Sync Completed' };
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
            .then(() => log(jobRunId, `status updated to Failed`))
            .then(async () => await updateLastEntryActivity(jobRunId))
            .catch((err) => log(jobRunId, `Failed to update status: ${err}`));
            return { message: `Sync Errored ${error}` };
        }
    }
}
