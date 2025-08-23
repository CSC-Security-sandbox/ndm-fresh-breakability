
import * as wf from '@temporalio/workflow';
import { proxyActivities } from '@temporalio/workflow';
import { JobRunStatus } from "src/activities/common/enums";
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { SyncService } from 'src/activities/core/migrate/sync-activity.service';
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
    syncTaskActivity: SyncTaskActivity,
} = proxyActivities<SyncService>({ 
    retry: { initialInterval: '10s', backoffCoefficient: 1,  maximumInterval: '30s', maximumAttempts: 10, nonRetryableErrorTypes: ['FatalError', 'RetryExceededError', 'ApplicationFailure'], },
     startToCloseTimeout: '5h', heartbeatTimeout: '1m', });

const {
    getGroupOfTasksActivity: getGroupOfTasksActivity,
}= proxyActivities<CommonTaskService>({
    retry: { maximumAttempts: 3, initialInterval: '10s', backoffCoefficient: 2.0, maximumInterval: '30s', nonRetryableErrorTypes: ['ActivityFailure','FatalError'] },
    startToCloseTimeout: '10m' });


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

        const taskIds: string[] = await getGroupOfTasksActivity(jobRunId);
        iterations+= taskIds.length;
        if(taskIds.length === 0 && isScanFinished(scanWorkflowStatus)) {
            console.log(`No more tasks to process in SyncWorkflow ${jobRunId}.`);
            continueSync = false;
            continue;
        }
        await Promise.all(
            taskIds.map(async (taskId) => {
                try {
                    console.log(`SyncTaskActivity started for taskId: ${taskId}`);
                    const output = await SyncTaskActivity({ jobRunId, taskId });
                    console.error(`SyncTaskActivity completed for taskId: ${taskId} with output: ${JSON.stringify(output)}`);
                    return output;
                } catch (error)  {
                    if(error instanceof wf.ActivityFailure && error.cause instanceof wf.ApplicationFailure){
                        if (error.cause.type === 'RetryExceededError') {
                            console.error(`SyncTaskActivity for taskId: ${taskId} has exceeded retry limit.`);
                            return { taskId, error: error.message };
                        }
                    }
                    console.error(`SyncTaskActivity failed for taskId: ${taskId} with error: ${JSON.stringify(error)} retrying...`);
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




