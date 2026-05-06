import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
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
            scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
            output.status = JobRunStatus.Stopped;
            output.scanJobStatus = JobRunStatus.Stopped;
            output.syncJobStatus = JobRunStatus.Stopped;
            return;
        }
        await signalIfRunning(scanWorkflow, 'scanActionSignal', action);    
        await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
    });

    if(output.status !== JobRunStatus.Stopped){
        scanWorkflow = await wf.startChild('ChildScanWorkflow', {
            args: [ { jobRunId: jobRunId, failedWorkers: [] , isMigration: true } ],
            workflowId: `ScanWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if(output.status !== JobRunStatus.Stopped){
        syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
            args: [ { jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running } ],
            workflowId: `SyncWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if(output.status !== JobRunStatus.Stopped){
        // Signal sync when scan finishes so sync knows to drain remaining tasks and exit
        scanWorkflow.result().then(
            (scanResult) => signalIfRunning(syncWorkflow, 'scanResultSignal', scanResult.status),
            () => signalIfRunning(syncWorkflow, 'scanResultSignal', JobRunStatus.Failed)
        );

        // Await both — Promise.all rejects immediately if either child fails,
        // giving us fail-fast behavior without blocking on a healthy workflow.
        try {
            const [scanWorkflowOutput, syncWorkflowOutput] = await Promise.all([
                scanWorkflow.result(),
                syncWorkflow.result()
            ]);
            output.fileCount = scanWorkflowOutput.fileCount;
            output.dirCount = scanWorkflowOutput.dirCount;
            output.scanJobStatus = scanWorkflowOutput.status;
            output.syncJobStatus = syncWorkflowOutput.status;
            output.excludedPaths = scanWorkflowOutput.excludedPaths ?? [];
            output.skippedPaths = scanWorkflowOutput.skippedPaths ?? [];
        } catch (error) {
            // One of the children failed — cancel both and fail the parent
            await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            await cancelWorkflowIfRunning(syncWorkflow.workflowId);

            if (wf.isCancellation(error.cause)) {
                output.scanJobStatus = JobRunStatus.Stopped;
                output.syncJobStatus = JobRunStatus.Stopped;
            } else {
                output.scanJobStatus = JobRunStatus.Failed;
                output.syncJobStatus = JobRunStatus.Failed;
            }

            await updateWorkerResponse(jobRunId, 'all', {
                status: output.syncJobStatus,
                code: 'TASK_FETCH_FAILURE',
                operation: 'Sync Workflow Failed',
                occurrence: 1,
                origin: 'ChildSyncWorkflow',
                message: `Child workflow failed with error: ${error.message}`,
                createdAt: new Date()
            });
        }
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}
