
import * as wf from '@temporalio/workflow';
import { proxyActivities } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { MigrateSyncService } from "src/activities/core/migrate/migrate-sync.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { updateJobStatusIfNotRunning } from '../common/workflow-utils';
import { SyncWorkflowOutput } from './chid-scan.workflow.type';


interface SyncWorkflowInput {
    jobRunId: string;
    scanWorkflowStatus: JobRunStatus;
    actionState: JobRunStatus; 
    workerConcurrency?: number;
}

const ITERATION_LIMIT = 1000;
const {
    updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h', heartbeatTimeout: '2m',});
  

const {
    syncTaskActivity: SyncTaskActivity,
} = proxyActivities<MigrateSyncService>({ 
    retry: { maximumAttempts: 3, initialInterval: '10s', backoffCoefficient: 2.0,  maximumInterval: '30s', nonRetryableErrorTypes: ['ActivityFailure','FatalError'], },
     startToCloseTimeout: '5h', heartbeatTimeout: '30s', });

const {
    getGroupOfTasksActivity: getGroupOfTasksActivity,
}= proxyActivities<CommonTaskService>({
    retry: { maximumAttempts: 3, initialInterval: '10s', backoffCoefficient: 2.0, maximumInterval: '30s', nonRetryableErrorTypes: ['ActivityFailure','FatalError'] },
    startToCloseTimeout: '5h', heartbeatTimeout: '30s', });


const actionSignal = wf.defineSignal<[JobRunStatus]>('syncActionSignal');
const scanResultSignal = wf.defineSignal<[JobRunStatus]>('scanResultSignal');


function isScanFinished(scanWorkflowStatus: JobRunStatus) : boolean {
    return scanWorkflowStatus === JobRunStatus.Completed || scanWorkflowStatus === JobRunStatus.Failed;
}

export const ChildSyncWorkflow = async ({jobRunId, scanWorkflowStatus = JobRunStatus.Running, actionState = JobRunStatus.Running, workerConcurrency= 20 } : SyncWorkflowInput) : Promise<SyncWorkflowOutput>=> {
    console.log(`Starting SyncWorkflow ${jobRunId}`)

    
    wf.setHandler(actionSignal, async (action:JobRunStatus)=>{
        console.log(jobRunId, `action signal called with value: ${action}`);
        actionState= action;
    });

    wf.setHandler(scanResultSignal, async (status:JobRunStatus) => {
        console.log(jobRunId, `scan workflow signal called with value: ${status}`);
        scanWorkflowStatus = status
    });
    
    const syncWorkflowOutput: SyncWorkflowOutput = {
        jobRunId,
        status: JobRunStatus.Ready,
    }
    let continueSync = true; 
    let isManualStop = false;
    let iterations = 0;
    while(continueSync) {
        
        await updateJobStatusIfNotRunning(actionState, jobRunId);
        
        await wf.condition(() => actionState !== JobRunStatus.Paused);

        if(actionState === JobRunStatus.Stopped as JobRunStatus) {
            console.log(`SyncWorkflow ${jobRunId} received stop signal.`);
            isManualStop = true
            break;
        }

        const taskIds: string[] = await getGroupOfTasksActivity(jobRunId, 1000, workerConcurrency);
        iterations+= taskIds.length;
        if(taskIds.length === 0 && isScanFinished(scanWorkflowStatus)) {
            console.log(`No more tasks to process in SyncWorkflow ${jobRunId}.`);
            continueSync = false;
            continue;
        }
        await Promise.all(
            taskIds.map(async (taskId) => {
                try {
                    const output = await SyncTaskActivity({ jobRunId, taskId });
                    console.debug(`SyncTaskActivity completed for taskId: ${taskId} with output: ${JSON.stringify(output)}`);
                    return output;
                } catch (error)  {
                    if(error instanceof wf.ActivityFailure)  {
                        console.error(`SyncTaskActivity failed for taskId: ${taskId} with error: ${error}`);
                        return { taskId, error: error.message };
                    }
                    throw error
                    // TODO: handle FatalError 
                }    
            })
        )      
        if(iterations > ITERATION_LIMIT){
            console.warn(`SyncWorkflow ${jobRunId} has exceeded 1000 iterations, stopping to prevent infinite loop.`);                      
            await wf.continueAsNew({ jobRunId, scanWorkflowStatus, actionState });      
        }
    }
    
    syncWorkflowOutput.status = isManualStop ? JobRunStatus.Stopped : JobRunStatus.Completed;
    return syncWorkflowOutput; 
}




