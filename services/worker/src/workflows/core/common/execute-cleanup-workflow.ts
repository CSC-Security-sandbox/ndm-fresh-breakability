import * as wf from '@temporalio/workflow'
import { CommonActivityService } from 'src/activities/common/common.service';
import { CleanupWorkerWorkflow } from "src/workflows/workflows";


const {
  cleanupJobContext: cleanupJobContextActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export interface CleanUpWorkersInput {
    jobRunId: string;
    workerIds: string[];
    options?: Record<string, any>; 
}


export const executeCleanup = async ({ jobRunId, workerIds, options}: CleanUpWorkersInput): Promise<void> => {
    console.log(`[${jobRunId}] Starting cleanup for workers: ${workerIds.join(', ')}`);
    const results = await Promise.allSettled(
        workerIds.map(async (workerId) => {
            try {
                return await wf.executeChild(CleanupWorkerWorkflow, {
                args: [{ jobRunId }],
                workflowId: `CleanupWorkerWorkflow-${jobRunId}-${workerId}`,
                taskQueue: `${workerId}-TaskQueue`,
                cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
                parentClosePolicy: wf.ParentClosePolicy.TERMINATE, 
                ...options
                });
            } catch (error) {
                if(error instanceof wf.ActivityFailure){
                    console.error(`[${jobRunId}] ActivityFailure in CleanupWorkerWorkflow with message: ${error.message}`);   
                }
                console.log("Errror in Cleanup Worker workflow  for workerId: ", workerId, error);
                throw error;       
            }
        })
    )
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            console.log(`[${jobRunId}] CleanupWorkerWorkflow for worker ${workerIds[index]}
            completed successfully.`);
        }
    });
    try{
        const response = await cleanupJobContextActivity(jobRunId)    
        console.log(`[${jobRunId}] CleanupJobContextActivity response: ${response}`);
    }catch(error){
        console.error(`[${jobRunId}] Error in CleanupJobContextActivity: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    
    
}