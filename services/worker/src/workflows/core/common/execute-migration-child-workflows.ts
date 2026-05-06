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
        let scanDone = false;
        let scanOutput: any = null;
        let scanFailed = false;
        let syncDone = false;
        let syncOutput: any = null;
        let syncFailed = false;
        let failError: any = null;

        scanWorkflow.result()
            .then((result) => { scanDone = true; scanOutput = result; })
            .catch((err) => { scanFailed = true; failError = failError || err; });

        syncWorkflow.result()
            .then((result) => { syncDone = true; syncOutput = result; })
            .catch((err) => { syncFailed = true; failError = failError || err; });

        // Phase 1: Wait for scan to complete OR either child to fail
        await wf.condition(() => scanDone || scanFailed || syncFailed);

        if (syncFailed || scanFailed) {
            await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            await cancelWorkflowIfRunning(syncWorkflow.workflowId);

            if (failError && wf.isCancellation(failError.cause)) {
                output.scanJobStatus = JobRunStatus.Stopped;
                output.syncJobStatus = JobRunStatus.Stopped;
            } else {
                output.scanJobStatus = JobRunStatus.Failed;
                output.syncJobStatus = JobRunStatus.Failed;
            }

            await updateWorkerResponse(jobRunId, 'all', {
                status: output.syncJobStatus,
                code: 'TASK_FETCH_FAILURE',
                operation: 'Child Workflow Failed',
                occurrence: 1,
                origin: syncFailed ? 'ChildSyncWorkflow' : 'ChildScanWorkflow',
                message: `Child workflow failed with error: ${failError?.message || 'Unknown error'}`,
                createdAt: new Date()
            });
        } else {
            // Scan completed — signal sync so it knows to drain and exit
            await signalIfRunning(syncWorkflow, 'scanResultSignal', scanOutput.status);

            // Phase 2: Wait for sync to complete OR fail
            await wf.condition(() => syncDone || syncFailed);

            if (syncFailed) {
                await cancelWorkflowIfRunning(scanWorkflow.workflowId);
                await cancelWorkflowIfRunning(syncWorkflow.workflowId);

                if (failError && wf.isCancellation(failError.cause)) {
                    output.scanJobStatus = JobRunStatus.Stopped;
                    output.syncJobStatus = JobRunStatus.Stopped;
                } else {
                    output.syncJobStatus = JobRunStatus.Failed;
                }

                await updateWorkerResponse(jobRunId, 'all', {
                    status: JobRunStatus.Failed,
                    code: 'TASK_FETCH_FAILURE',
                    operation: 'Sync Workflow Failed',
                    occurrence: 1,
                    origin: 'ChildSyncWorkflow',
                    message: `Child workflow failed with error: ${failError?.message || 'Unknown error'}`,
                    createdAt: new Date()
                });
            } else {
                // Both completed successfully
                output.fileCount = scanOutput.fileCount;
                output.dirCount = scanOutput.dirCount;
                output.scanJobStatus = scanOutput.status;
                output.syncJobStatus = syncOutput.status;
                output.excludedPaths = scanOutput.excludedPaths ?? [];
                output.skippedPaths = scanOutput.skippedPaths ?? [];
            }
        }
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}
