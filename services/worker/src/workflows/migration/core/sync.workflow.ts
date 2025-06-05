import * as wf from '@temporalio/workflow';
import { ContinueAsNew, continueAsNew, proxyActivities } from "@temporalio/workflow";
import { CommonActivityService } from "src/activities/common/common.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";
import { SyncTaskOutput } from 'src/activities/migrate/migrate.type';

interface SyncWorkflowInput {
    jobRunId: string;
    workers: string[];
    failedWorkers: string[];
    isScanCompleted: boolean;
}

interface SyncWorkflowOutput{
    jobRunId: string;
    workers: string[];
    failedWorkers: string[];
    status: JobRunStatus;
    error?: string;
}
  

const {
    syncTask: SyncContentActivity
} = proxyActivities<MigrationSyncService>({ startToCloseTimeout: '5h', heartbeatTimeout: '2m', });


const {
    updateStatus: updateStatusActivity,
    updateLastEntry: updateLastEntryActivity,
    getJobState: getJobStateActivity,
    setJobState: setJobStateActivity,
    getJobStateAndUpdateTaskList: getJobStateAndUpdateTaskList,
    hasRunningSyncTask: hasRunningSyncTaskActivity
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h', heartbeatTimeout: '2m',});
  

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}


export const syncWorkerListSignal = wf.defineSignal<[string[]]>('syncWorkerList');
export const isScanCompletedSignal = wf.defineSignal('isScanCompleted');

export const SyncWorkflow = async ({jobRunId, workers, failedWorkers, isScanCompleted = false } : SyncWorkflowInput) : Promise<SyncWorkflowOutput>=> {
    console.log('Starting SyncWorkflow ', jobRunId)
    
    wf.setHandler(isScanCompletedSignal, () => {
        log(jobRunId, `isScanCompletedSignal called with value: ${isScanCompleted}`);
        isScanCompleted = true;
    });

    // signal handler for syncWorkerList
    wf.setHandler(syncWorkerListSignal, (workerList: string[]) => {
        log(jobRunId, `syncWorkerListSignal called with value: ${workerList}`);
        for(const worker of workerList) 
        if (!workers.includes(worker)) 
            workers.push(worker);
    });

    let iteration = 0;
    
    try {
        while (true) {
            iteration++;
            const jobState = await getJobStateAndUpdateTaskList(jobRunId, 'SYNC')

            log(jobRunId,`Iteration number ${iteration} for scan | status: ${jobState.status} | workers_agreed: ${workers} | isScanCompleted: ${jobState?.isScanCompleted} `);

            if(jobState.status === JobRunStatus.Stopped) {
                log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
                return { jobRunId, workers, failedWorkers, status: JobRunStatus.Stopped };
            }
        
            if(jobState.status === JobRunStatus.Paused) {
                log(jobRunId, `JobRun ${jobRunId} is stopped. Exiting scan workflow.`);
                return { jobRunId, workers, failedWorkers, status: JobRunStatus.Paused };
            }
        
            const outputs:SyncTaskOutput[] = await Promise.all(
                workers.map(async() => { 
                    try {
                        return await SyncContentActivity({ jobRunId , failedWorkers})
                    } catch (error) {
                        if (error instanceof wf.ActivityFailure) {
                            console.error('Activity failed.', error);
                        }
                    }
                })
            );

             // TODO: handle the offline workers scenario 
            let taskNotFoundCount:number = 0;
            for(const output of outputs) {
                if(!workers.includes(output.workerId)) workers.push(output.workerId);
                if(output.isFatal && !failedWorkers.includes(output.workerId)) { 
                    failedWorkers.push(output.workerId);
                    log(jobRunId, `Worker ${output.workerId} has failed with error: ${output.errors}`);
                }
                if(output.noTaskFound && !failedWorkers.includes(output.workerId)) taskNotFoundCount++;
            }

            const isErrored = (workers.length === failedWorkers.length) && isScanCompleted ;
            const hasRunningSyncTask = await hasRunningSyncTaskActivity(jobRunId);
            const isCompleted = (taskNotFoundCount === (workers.length-failedWorkers.length)) && isScanCompleted && hasRunningSyncTask;
       
            if (isCompleted || isErrored) {
                log(jobRunId, `No tasks found. sending last entry`);
                await updateLastEntryActivity(jobRunId)
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
                await continueAsNew({ jobRunId, workers, failedWorkers, isScanCompleted});
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
            return { jobRunId, workers, failedWorkers, status: JobRunStatus.Errored,  error: error?.message };
        }
    }
}
