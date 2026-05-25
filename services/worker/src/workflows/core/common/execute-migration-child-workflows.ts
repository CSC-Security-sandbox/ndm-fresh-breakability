import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { JobRunStatus } from "src/activities/common/enums";
import { cancelWorkflowIfRunning, getUnifiedJobStatus, signalIfRunning } from './workflow-utils';




const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '30m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const { 
    updateWorkerResponse: updateWorkerResponse 
} = wf.proxyActivities<CommonActivityService>({ 
    startToCloseTimeout: '10m' , 
    retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 } 
});

const {
    getWorkerScanConfig: getWorkerScanConfigActivity,
} = wf.proxyActivities<CommonTaskService>({
    startToCloseTimeout: '1m',
    retry: { maximumAttempts: 3, initialInterval: '10s', backoffCoefficient: 1 },
});

export const actionSignal = wf.defineSignal<[string]>('action');

interface MigrationWorkflowExecutorInput {
    jobRunId: string;
}

interface MigrationWorkflowExecutorOutput {
    status: JobRunStatus;
    fileCount: number;
    dirCount: number;
    scanJobStatus: JobRunStatus;
    syncJobStatus: JobRunStatus;
    excludedPaths?: Array<{ path: string; isDirectory?: boolean; matchedPattern?: string }>;
    skippedPaths?: Array<{ path: string; isDirectory?: boolean }>;
}


export const executeMigrationChildWorkflows = async ({jobRunId}: MigrationWorkflowExecutorInput): Promise<MigrationWorkflowExecutorOutput> => {

    let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>, syncWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
    let stopRequested = false;
    let output: MigrationWorkflowExecutorOutput = {
        status: JobRunStatus.Running,
        fileCount: 0,
        dirCount: 0,
        scanJobStatus: JobRunStatus.Running,
        syncJobStatus: JobRunStatus.Running,
        excludedPaths: [],
        skippedPaths: [],
    };

    wf.setHandler(actionSignal, async (action:string) => {  
        if(action == JobRunStatus.Stopped){
            stopRequested = true;
            scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            await signalIfRunning(syncWorkflow, 'syncActionSignal', JobRunStatus.Stopped);
            output.scanJobStatus = JobRunStatus.Stopped;
            return;
        }
        await signalIfRunning(scanWorkflow, 'scanActionSignal', action);    
        await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
    });

    if (!stopRequested) {
        const { concurrency: workerConcurrency, batchSize } = await getWorkerScanConfigActivity();
        scanWorkflow = await wf.startChild('ChildScanWorkflow', {
            args: [ { jobRunId: jobRunId, isMigration: true, workerConcurrency, batchSize } ],
            workflowId: `ScanWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if (!stopRequested) {
        syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
            args: [ { jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running, actionState: JobRunStatus.Running } ],
            workflowId: `SyncWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if (scanWorkflow) {
        try {
            const scanWorkflowOutput = await scanWorkflow.result();
            output.fileCount = scanWorkflowOutput.fileCount;
            output.dirCount = scanWorkflowOutput.dirCount;
            output.scanJobStatus = scanWorkflowOutput.status;
            output.excludedPaths = scanWorkflowOutput.excludedPaths ?? [];
            output.skippedPaths = scanWorkflowOutput.skippedPaths ?? [];
        } catch (error) {  
            if (wf.isCancellation(error.cause)) {
                output.scanJobStatus = JobRunStatus.Stopped;
            } else {
                output.scanJobStatus = JobRunStatus.Failed;
                syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
            }
        }

        await signalIfRunning(syncWorkflow, 'scanResultSignal', output.scanJobStatus);
    }

    if (syncWorkflow) {
        try{
            const syncWorkflowOutput = await syncWorkflow.result(); 
            
            output.syncJobStatus = syncWorkflowOutput.status;    
        }catch(error){  
            if (wf.isCancellation(error.cause)) {
                output.syncJobStatus = JobRunStatus.Stopped;
            }else {
                output.syncJobStatus = JobRunStatus.Failed;
            }
            await updateWorkerResponse(jobRunId, 'all', {
                status: output.syncJobStatus,
                code: 'TASK_FETCH_FAILURE',
                operation: 'Sync Workflow Failed',
                occurrence: 1,
                origin: 'ChildSyncWorkflow',
                message: `Sync workflow failed with error: ${error.message}`,
                createdAt: new Date()
            });
            scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
        }
    } else if (stopRequested) {
        output.syncJobStatus = JobRunStatus.Stopped;
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}