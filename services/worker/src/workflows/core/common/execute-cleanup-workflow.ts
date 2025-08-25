import * as wf from '@temporalio/workflow'
import { CommonActivityService } from 'src/activities/common/common.service';
import { CleanupWorkerWorkflow } from "src/workflows/workflows";


const {
  cleanupJobContext: cleanupJobContextActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '30m', retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 2, maximumInterval: '2m' } });



export interface CleanUpWorkersInput {
    jobRunId: string;
    workerIds: string[];
    options?: Record<string, any>; 
}


export const executeCleanup = async ({ jobRunId, workerIds, options}: CleanUpWorkersInput): Promise<void> => {
    
    await Promise.allSettled(
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
                throw error;       
            }
        })
    )

    const response = await cleanupJobContextActivity(jobRunId)
    console.log(`[${jobRunId}] CleanupJobContextActivity response: ${response}`);
    
}