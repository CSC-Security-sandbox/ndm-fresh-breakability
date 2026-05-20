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

    if (!stopRequested) {
        let errorReported = false;

        const handleError = async (error: any, operation: string, origin: string, siblingWorkflowId: string): Promise<JobRunStatus> => {
            if (wf.isCancellation(error) || wf.isCancellation(error?.cause)) {
                await cancelWorkflowIfRunning(siblingWorkflowId);
                return JobRunStatus.Stopped;
            }
            if (!errorReported) {
                errorReported = true;
                await updateWorkerResponse(jobRunId, 'all', {
                    status: JobRunStatus.Failed,
                    code: 'TASK_FETCH_FAILURE',
                    operation,
                    occurrence: 1,
                    origin,
                    message: `${operation} failed with error: ${error?.message || 'Unknown error'}`,
                    createdAt: new Date()
                });
            }
            await cancelWorkflowIfRunning(siblingWorkflowId);
            return JobRunStatus.Failed;
        };

        const scanPromise = scanWorkflow.result()
            .then(async (scanWorkflowOutput) => {
                output.fileCount = scanWorkflowOutput.fileCount;
                output.dirCount = scanWorkflowOutput.dirCount;
                output.scanJobStatus = scanWorkflowOutput.status;
                output.excludedPaths = scanWorkflowOutput.excludedPaths ?? [];
                output.skippedPaths = scanWorkflowOutput.skippedPaths ?? [];
                await signalIfRunning(syncWorkflow, 'scanResultSignal', output.scanJobStatus);
            })
            .catch(async (error) => {
                output.scanJobStatus = await handleError(error, 'Scan Workflow Failed', 'ChildScanWorkflow', syncWorkflow.workflowId);
            });

        const syncPromise = syncWorkflow.result()
            .then(async (syncWorkflowOutput) => {
                output.syncJobStatus = syncWorkflowOutput.status;
            })
            .catch(async (error) => {
                output.syncJobStatus = await handleError(error, 'Sync Workflow Failed', 'ChildSyncWorkflow', scanWorkflow.workflowId);
            });

        await Promise.all([scanPromise, syncPromise]);
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}