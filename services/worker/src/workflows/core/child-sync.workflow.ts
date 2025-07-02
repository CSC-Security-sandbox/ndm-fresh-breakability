
import * as wf from '@temporalio/workflow';
import { proxyActivities } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { MigrateSyncService } from "src/activities/core/migrate/migrate-sync.service";
import { JobRunStatus } from "src/activities/discovery/enums";
import { ScanWorkflowStatus, SyncWorkflowOutput } from './chid-scan.workflow.type';
import { updateJobStatusIfNotRunning } from './common/workflow-utils';
import { JobStatus as JobContextStatus } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/enums';


interface SyncWorkflowInput {
    jobRunId: string;
    scanWorkflowStatus: ScanWorkflowStatus;
}

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


const actionSignal = wf.defineSignal<[string]>('syncActionSignal');
const scanResultSignal = wf.defineSignal<[ScanWorkflowStatus]>('scanResultSignal');


function isScanFinished(scanWorkflowStatus: ScanWorkflowStatus) : boolean {
    return scanWorkflowStatus === ScanWorkflowStatus.Completed || scanWorkflowStatus === ScanWorkflowStatus.Failed;
}

export const ChildSyncWorkflow = async ({jobRunId, scanWorkflowStatus = ScanWorkflowStatus.Running } : SyncWorkflowInput) : Promise<SyncWorkflowOutput>=> {
    console.log(`Starting SyncWorkflow ${jobRunId}`)
    let jobState:JobRunStatus = JobRunStatus.Running;
    
    wf.setHandler(actionSignal, async (action:string)=>{
        console.log(jobRunId, `action signal called with value: ${action}`);
        jobState= action as JobRunStatus;
    });

    wf.setHandler(scanResultSignal, (status:ScanWorkflowStatus) => {
        console.log(jobRunId, `scan workflow signal called with value: ${status}`);
        scanWorkflowStatus = status
    });
    
    
    let failedTasks = [];
    const syncWorkflowOutput: SyncWorkflowOutput = {
        jobRunId,
        status: JobRunStatus.Ready,
    }
    let continueSync = true; 
    let isManualStop = false;
    while(continueSync) {
        
        await updateJobStatusIfNotRunning(jobState, jobRunId);
        
        await wf.condition(() => jobState !== JobRunStatus.Paused);

        if(jobState === JobRunStatus.Stopped as JobRunStatus) {
            console.log(`SyncWorkflow ${jobRunId} received stop signal.`);
            isManualStop = true
            break;
        }

        const taskIds: string[] = await getGroupOfTasksActivity(jobRunId, 1000);

        if(taskIds.length === 0 && isScanFinished(scanWorkflowStatus)) {
            console.log(`No more tasks to process in SyncWorkflow ${jobRunId}.`);
            continueSync = false;
            continue;
        }
        const results = await Promise.all(
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
        failedTasks = results.filter(result => result.error);        
    }
    if(failedTasks.length > 0) {
        syncWorkflowOutput.status = JobRunStatus.Failed;
        console.error(`Failed tasks in this iteration: ${JSON.stringify(failedTasks)}`);
    }else{
        syncWorkflowOutput.status = isManualStop ? JobRunStatus.Stopped : JobRunStatus.Completed;
    }
    await updateLastEntryActivity(jobRunId)
    return syncWorkflowOutput; 
}




