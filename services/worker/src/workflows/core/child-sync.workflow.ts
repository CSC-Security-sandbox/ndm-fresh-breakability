
import { proxyActivities, log } from '@temporalio/workflow';
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrateSyncService } from "src/activities/core/migrate/migrate-sync.service";
import { isScanCompletedSignal } from "../migration/core/sync.workflow";
import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { FatalError, RetryableError } from 'src/errors/errors.types';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';

interface SyncWorkflowOutput{
    jobRunId: string;
    status: JobRunStatus;
    error?: string;
}

interface SyncWorkflowInput {
    jobRunId: string;
    isScanCompleted: boolean;
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


/*
    Task - existing Task in current code .  <id, command[] > pushed while scan . 

    getGroupOfTasksActivity
    

------
    Scan: 
             push commands in a command stream  

    Sync:
         taskIDs[] =  getGroupOfTasksActivity 
                        - fetch a group of commands (1000) and create a 10 tasks out of  it 
                                - it will calculate the taskID based on the commands btach(100)
                                - in redis created   taskId - Task( UUID?, command[] ,  status )
        for each taskID in taskIds
                SyncTaskActivity(taskID)
                    - stream.add(task)                  
                    - do sync .     
                    - stream.add(task, Compelted)
                    - delete taskID from redis 

                                
                        
        DB Writer: 
            - upsert based on taskID. 

*/

export const ChildSyncWorkflow = async ({jobRunId, isScanCompleted = false } : SyncWorkflowInput) : Promise<SyncWorkflowOutput>=> {
    console.log(`Starting SyncWorkflow ${jobRunId}`)

    wf.setHandler(isScanCompletedSignal, () => {
        console.log(jobRunId, `isScanCompletedSignal called with value: ${isScanCompleted}`);
        isScanCompleted = true;
    });
    let failedTasks = [];
    const syncWorkflowOutput: SyncWorkflowOutput = {
        jobRunId,
        status: JobRunStatus.Ready,
    }
    let syncInProgress = true; 
    while(syncInProgress){
        const taskIds: string[] = await getGroupOfTasksActivity(jobRunId, 1000);

        if(taskIds.length === 0 && isScanCompleted) {
            syncInProgress = false;
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
        syncWorkflowOutput.status = JobRunStatus.Completed;
    }
    await updateLastEntryActivity(jobRunId)
    return syncWorkflowOutput; 
}




