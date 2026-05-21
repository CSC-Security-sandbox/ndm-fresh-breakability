import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { JobRunStatus } from 'src/activities/common/enums';
import { ChildScanWorkflowOutput } from '../child/chid-scan.workflow.type';
import { cancelWorkflowIfRunning, signalIfRunning } from './workflow-utils';


interface DiscoveryWorkflowExecutorInput {
    jobRunId: string;
}

interface DiscoveryWorkflowExecutorOutput {
    status: JobRunStatus;
    fileCount: number;
    dirCount: number;
    excludedPaths?: Array<{ path: string; isDirectory?: boolean; matchedPattern?: string }>;
    skippedPaths?: Array<{ path: string; isDirectory?: boolean }>;
}


const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '10m',  
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});

const { 
    updateWorkerResponse: updateWorkerResponse 
} = wf.proxyActivities<CommonActivityService>({ 
    startToCloseTimeout: '10m',
    retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});

const {
    getWorkerScanConfig: getWorkerScanConfigActivity,
} = wf.proxyActivities<CommonTaskService>({
    startToCloseTimeout: '1m',
    retry: { maximumAttempts: 3, initialInterval: '10s', backoffCoefficient: 1 },
});

const actionSignal = wf.defineSignal<[string]>('action');

export const executeDiscoveryChildWorkflows = async ( {jobRunId } : DiscoveryWorkflowExecutorInput ) => {

    let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
    let output: DiscoveryWorkflowExecutorOutput = {
        status: JobRunStatus.Running,
        fileCount: 0,
        dirCount: 0,
        excludedPaths: [],
        skippedPaths: [],
    };


    wf.setHandler(actionSignal, async (action:string) => {  
        if(action == JobRunStatus.Stopped){
            scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            output.status = JobRunStatus.Stopped;
            return;
        }
        await signalIfRunning(scanWorkflow, 'scanActionSignal', action); 
    });

    if(output.status !== JobRunStatus.Stopped) {
        const { concurrency: workerConcurrency, batchSize } = await getWorkerScanConfigActivity();

        scanWorkflow = await wf.startChild('ChildScanWorkflow', {
            args: [ { jobRunId, isMigration: false, workerConcurrency, batchSize } ],
            workflowId: `ScanWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });

        try{
            const scanWorkflowResult: ChildScanWorkflowOutput = await scanWorkflow.result();
            output.status = scanWorkflowResult.status;
            output.fileCount = scanWorkflowResult.fileCount;
            output.dirCount = scanWorkflowResult.dirCount;
            output.excludedPaths = scanWorkflowResult.excludedPaths ?? [];
            output.skippedPaths = scanWorkflowResult.skippedPaths ?? [];
        }catch(error) {
            if (wf.isCancellation(error.cause)) {
                // The workflow was cancelled
                output.status = JobRunStatus.Stopped;
            }else {
                console.log(`[${jobRunId}] Error in ChildScanWorkflow: ${error.message}`);
                output.status = JobRunStatus.Failed;
                await updateWorkerResponse(jobRunId, 'all', {
                    status: output.status,
                    code: 'SCAN_ACTIVITY_FAILURE',
                    operation: 'Scan Workflow Failed',
                    occurrence: 1,
                    origin: 'ChildScanWorkflow',
                    message: `Scan workflow failed with error: ${error.message}`,
                    createdAt: new Date()
            });                
            }      
        }
    }
    await updateLastEntryActivity(jobRunId);
    return output;

}