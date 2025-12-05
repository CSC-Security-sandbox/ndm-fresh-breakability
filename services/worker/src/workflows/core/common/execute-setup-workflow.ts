import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';


const {
  updateJobErrorStatus: updateJobErrorActivity,
  updateWorkerResponse: updateWorkerResponse,
} = wf.proxyActivities<CommonActivityService>({ 
    startToCloseTimeout: '5h' ,
    retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});



export interface SetupWorkerInput {
    jobRunId: string;
    workerIds: string[];
    options?: Record<string, any>; 
}


export interface SetupWorkerOutput {
    setupCompletedWorkers: string[];
    failedWorkers: string[];
}

export const executeWorkerSetup = async ( { jobRunId, workerIds , options}: SetupWorkerInput): Promise<SetupWorkerOutput> => {
    const setupCompletedWorkers : string[] = [];
    const failedWorkers: string[] = [];

    workerIds.map(async (worker) => {

        const workerFuture = await wf.startChild('SetupWorkerWorkflow', {
            args: [ { jobRunId } ],
            workflowId: `SetupWorkerWorkflow-${jobRunId}-${worker}`,
            taskQueue: `${worker}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE, 
            ...options
        });

        try{
            const result = await workerFuture.result();
            if (result?.status === 'success') 
                setupCompletedWorkers.push(worker);
            else {
                failedWorkers.push(worker);
                await updateWorkerFailedResponse(worker, jobRunId, result?.message || 'Unknown error');
            }
        }catch (error) {
            console.error(`Error in SetupWorkerWorkflow for worker ${worker}: ${error.message}`);
            failedWorkers.push(worker);

            let detailedErrorMessage = error.message || 'An unknown error occurred during worker setup';
            if (error.message?.includes('ECONNRESET')) {
                detailedErrorMessage = 'Connection lost during worker setup. Please check network connectivity and try again.';
            } else if (error.message?.includes('ETIMEDOUT')) {
                detailedErrorMessage = 'Worker setup timed out. Please try again later.';
            }

            await updateWorkerFailedResponse(worker, jobRunId, detailedErrorMessage);
        }

    })

    await wf.condition(() => (setupCompletedWorkers.length > 0) || (failedWorkers.length === workerIds.length));

    if(failedWorkers.length === workerIds.length) {
        await updateJobErrorActivity(jobRunId)
        throw wf.ApplicationFailure.nonRetryable(`All workers failed to setup: ${failedWorkers.join(', ')}`);
    }

    return { setupCompletedWorkers, failedWorkers}
}

const updateWorkerFailedResponse = async (workerId: string, jobRunId: string, message: string) => {
     await updateWorkerResponse(jobRunId, workerId, {
        status: 'FAILED',
        code: 'SETUP_WORKER_FAILURE',
        operation: 'Worker Setup Failed',
        occurrence: 1,
        origin: 'Worker',
        message: message,
        createdAt: new Date()
    });
}