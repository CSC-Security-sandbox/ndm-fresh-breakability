import * as wf from '@temporalio/workflow';
import { ContinueAsNew, continueAsNew, proxyActivities } from "@temporalio/workflow";
import { CommonActivityService } from "src/activities/common/common.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";

interface SyncWorkflowInput {
    jobRunId: string;
    isScanCompleted: boolean;
}

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


export const isScanCompletedSignal = wf.defineSignal('isScanCompleted');


export const SyncWorkflow = async ({jobRunId, isScanCompleted = false } : SyncWorkflowInput) => {
    console.log('Starting SyncWorkflow ', jobRunId)
    wf.setHandler(isScanCompletedSignal, () => {
        log(jobRunId, `isScanCompletedSignal called with value: ${isScanCompleted}`);
        isScanCompleted = true;
    });
    let iteration = 0;
    try {
        while (true) {
            iteration++;
            const jobState = await getJobStateActivity(jobRunId)

            log(jobRunId,`Iteration number ${iteration} for scan | status: ${jobState.status} | workers_agreed: ${jobState.workers_agreed} | isScanCompleted: ${jobState?.isScanCompleted} `);

            if(jobState.status === JobRunStatus.Stopped) {
                log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
                return { message: 'Scan Stopped' };
            }
        
            if(jobState.status === JobRunStatus.Paused) {
                log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
                return { message: 'Scan Stopped' };
            }
        
            const outputs = await Promise.all(
                jobState.workers_agreed.map(async() => { return await SyncContentActivity({ jobRunId })})
            );

            const noTaskFound = outputs.every((output) => output.noTaskFound);
            const isFatalErrored = outputs.every((output) => output.isFatal);
        

            if (noTaskFound && isScanCompleted) {
                log(jobRunId, `No tasks found. sending last entry`);
                await updateLastEntryActivity(jobRunId)
                .then(() => log(jobRunId, `status updated to Completed`))
                .catch((err) => log(jobRunId, `Failed to update status: ${err}`));
                const currentJobState = await getJobStateActivity(jobRunId);
                await setJobStateActivity(jobRunId, { ...currentJobState, status:  JobRunStatus.Completed });
                const finalJobState = await getJobStateActivity(jobRunId);
                log(jobRunId, `Sync completed with finalJobState: ${JSON.stringify(finalJobState)}`);
                return { message: 'Sync Completed' };
              }


            if(isFatalErrored) {
                log(jobRunId, `Fatal Error Occurred On jobRunId ${jobRunId}`)
                const currentJobState = await getJobStateActivity(jobRunId);
                const updatedJobState = {...currentJobState, status: JobRunStatus.Errored};
                await setJobStateActivity(jobRunId, updatedJobState);
                return { message: 'Sync Errored' };
              }

            if(iteration >= 100) {
                log(jobRunId, `Iteration limit reached. Continuing as new...`);
                await continueAsNew({ jobRunId , isScanCompleted});
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
