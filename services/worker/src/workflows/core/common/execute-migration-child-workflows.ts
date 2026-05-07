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
export const childWorkflowDoneSignal = wf.defineSignal<[string, any]>('childWorkflowDone');
export const childWorkflowFailedSignal = wf.defineSignal<[string, string]>('childWorkflowFailed');

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
    let output: MigrationWorkflowExecutorOutput = {
        status: JobRunStatus.Running,
        fileCount: 0,
        dirCount: 0,
        scanJobStatus: JobRunStatus.Running,
        syncJobStatus: JobRunStatus.Running,
        excludedPaths: [],
        skippedPaths: [],
    };

    let scanDone = false;
    let scanOutput: any = null;
    let syncDone = false;
    let syncOutput: any = null;
    let childFailed = false;
    let failedChild = '';
    let failErrorMessage = '';
    let isStopped = false;

    wf.setHandler(childWorkflowDoneSignal, (workflowType: string, result: any) => {
        if (workflowType === 'scan') { scanDone = true; scanOutput = result; }
        if (workflowType === 'sync') { syncDone = true; syncOutput = result; }
    });

    wf.setHandler(childWorkflowFailedSignal, (workflowType: string, errorMessage: string) => {
        childFailed = true;
        failedChild = workflowType;
        failErrorMessage = errorMessage;
    });

    wf.setHandler(actionSignal, async (action:string) => {  
        if(action == JobRunStatus.Stopped){
            scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
            output.status = JobRunStatus.Stopped;
            output.scanJobStatus = JobRunStatus.Stopped;
            output.syncJobStatus = JobRunStatus.Stopped;
            isStopped = true;
            return;
        }
        await signalIfRunning(scanWorkflow, 'scanActionSignal', action);    
        await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
    });

    const parentWorkflowId = `MigrationWorkflow-${jobRunId}`;

    if(output.status !== JobRunStatus.Stopped){
        const { concurrency: workerConcurrency, batchSize } = await getWorkerScanConfigActivity();
        scanWorkflow = await wf.startChild('ChildScanWorkflow', {
            args: [ { jobRunId: jobRunId, isMigration: true, workerConcurrency, batchSize, parentWorkflowId } ],
            workflowId: `ScanWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if(output.status !== JobRunStatus.Stopped){
        syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
            args: [ { jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running, parentWorkflowId } ],
            workflowId: `SyncWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if(output.status !== JobRunStatus.Stopped){
        // Phase 1: Wait for scan to complete OR any child to fail
        await wf.condition(() => scanDone || childFailed || isStopped);

        if (isStopped) {
            // Handled by actionSignal handler above
        } else if (childFailed) {
            await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            await cancelWorkflowIfRunning(syncWorkflow.workflowId);
            output.scanJobStatus = failedChild === 'scan' ? JobRunStatus.Failed : JobRunStatus.Stopped;
            output.syncJobStatus = failedChild === 'sync' ? JobRunStatus.Failed : JobRunStatus.Stopped;

            await updateWorkerResponse(jobRunId, 'all', {
                status: JobRunStatus.Failed,
                code: 'TASK_FETCH_FAILURE',
                operation: 'Child Workflow Failed',
                occurrence: 1,
                origin: failedChild === 'sync' ? 'ChildSyncWorkflow' : 'ChildScanWorkflow',
                message: `Child workflow failed with error: ${failErrorMessage}`,
                createdAt: new Date()
            });
        } else {
            // Scan completed — signal sync so it knows to drain and exit
            output.fileCount = scanOutput.fileCount;
            output.dirCount = scanOutput.dirCount;
            output.scanJobStatus = scanOutput.status;
            output.excludedPaths = scanOutput.excludedPaths ?? [];
            output.skippedPaths = scanOutput.skippedPaths ?? [];
            await signalIfRunning(syncWorkflow, 'scanResultSignal', output.scanJobStatus);

            // Phase 2: Wait for sync to complete OR fail
            await wf.condition(() => syncDone || childFailed || isStopped);

            if (isStopped) {
                // Handled by actionSignal handler above
            } else if (childFailed) {
                await cancelWorkflowIfRunning(scanWorkflow.workflowId);
                await cancelWorkflowIfRunning(syncWorkflow.workflowId);
                output.syncJobStatus = JobRunStatus.Failed;

                await updateWorkerResponse(jobRunId, 'all', {
                    status: JobRunStatus.Failed,
                    code: 'TASK_FETCH_FAILURE',
                    operation: 'Sync Workflow Failed',
                    occurrence: 1,
                    origin: 'ChildSyncWorkflow',
                    message: `Child workflow failed with error: ${failErrorMessage}`,
                    createdAt: new Date()
                });
            } else {
                // Sync completed successfully
                output.syncJobStatus = syncOutput.status;
            }
        }
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}