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
            try {
                scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
                await signalIfRunning(syncWorkflow, 'syncActionSignal', JobRunStatus.Stopped);
                output.scanJobStatus = JobRunStatus.Stopped;
            } catch (error) {
                console.error(`[${jobRunId}] Failed to stop child workflows: ${error.message}`);
                output.status = JobRunStatus.Failed;
                output.scanJobStatus = JobRunStatus.Failed;
                output.syncJobStatus = JobRunStatus.Failed;
                await updateWorkerResponse(jobRunId, 'all', {
                    status: JobRunStatus.Failed,
                    code: 'SIGNAL_FAILURE',
                    operation: 'Stop Workflow',
                    occurrence: 1,
                    origin: 'MigrationWorkflow',
                    message: `Failed to stop child workflows: ${error.message}`,
                    createdAt: new Date(),
                });
            }
            return;
        }
        try {
            await signalIfRunning(scanWorkflow, 'scanActionSignal', action);
            await signalIfRunning(syncWorkflow, 'syncActionSignal', action);
        } catch (error) {
            console.error(`[${jobRunId}] Failed to forward signal '${action}' to child workflows: ${error.message}`);
            await updateWorkerResponse(jobRunId, 'all', {
                status: JobRunStatus.Failed,
                code: 'SIGNAL_FAILURE',
                operation: 'Forward Signal',
                occurrence: 1,
                origin: 'MigrationWorkflow',
                message: `Failed to forward '${action}' signal to child workflows: ${error.message}`,
                createdAt: new Date(),
            });
        }
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

    if (scanWorkflow && syncWorkflow) {
        let failErrorMessage = '';
        let failOrigin = '';
        let failOperation = '';

        const handleError = async (
            error: any,
            siblingWorkflowId: string,
            origin: string,
            operation: string,
        ): Promise<JobRunStatus> => {
            if (wf.isCancellation(error) || wf.isCancellation(error?.cause)) {
                return JobRunStatus.Stopped;
            }
            failErrorMessage = error?.message || 'Unknown error';
            failOrigin = origin;
            failOperation = operation;
            try {
                await cancelWorkflowIfRunning(siblingWorkflowId);
            } catch (cancelErr) {
                console.error(`[${jobRunId}] Failed to cancel sibling workflow ${siblingWorkflowId}: ${cancelErr.message}`);
            }
            return JobRunStatus.Failed;
        };

        const scanPromise = scanWorkflow.result()
            .then(async (scanWorkflowOutput) => {
                output.fileCount = scanWorkflowOutput.fileCount;
                output.dirCount = scanWorkflowOutput.dirCount;
                output.scanJobStatus = scanWorkflowOutput.status;
                output.excludedPaths = scanWorkflowOutput.excludedPaths ?? [];
                output.skippedPaths = scanWorkflowOutput.skippedPaths ?? [];
                try {
                    await signalIfRunning(syncWorkflow, 'scanResultSignal', output.scanJobStatus);
                } catch (error) {
                    console.error(`[${jobRunId}] Failed to send scanResultSignal to sync workflow: ${error.message}`);
                    output.scanJobStatus = JobRunStatus.Failed;
                    output.syncJobStatus = JobRunStatus.Failed;
                    await updateWorkerResponse(jobRunId, 'all', {
                        status: JobRunStatus.Failed,
                        code: 'SIGNAL_FAILURE',
                        operation: 'Scan Result Signal',
                        occurrence: 1,
                        origin: 'MigrationWorkflow',
                        message: `Failed to notify sync workflow that scan completed: ${error.message}`,
                        createdAt: new Date(),
                    });
                    try { syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId); }
                    catch (cancelErr) { console.error(`[${jobRunId}] Failed to cancel sync workflow after scanResultSignal failure: ${cancelErr.message}`); }
                }
            })
            .catch(async (error) => {
                output.scanJobStatus = await handleError(error, syncWorkflow.workflowId, 'ChildScanWorkflow', 'Scan Workflow Failed');
            });

        const syncPromise = syncWorkflow.result()
            .then(async (syncWorkflowOutput) => {
                output.syncJobStatus = syncWorkflowOutput.status;
            })
            .catch(async (error) => {
                output.syncJobStatus = await handleError(error, scanWorkflow.workflowId, 'ChildSyncWorkflow', 'Sync Workflow Failed');
            });

        await Promise.all([scanPromise, syncPromise]);

        if (failErrorMessage) {
            await updateWorkerResponse(jobRunId, 'all', {
                status: JobRunStatus.Failed,
                code: 'TASK_FETCH_FAILURE',
                operation: failOperation,
                occurrence: 1,
                origin: failOrigin,
                message: `${failOperation} with error: ${failErrorMessage}`,
                createdAt: new Date()
            });
        }
    } else if (scanWorkflow) {
        try {
            const scanWorkflowOutput = await scanWorkflow.result();
            output.fileCount = scanWorkflowOutput.fileCount;
            output.dirCount = scanWorkflowOutput.dirCount;
            output.scanJobStatus = scanWorkflowOutput.status;
            output.excludedPaths = scanWorkflowOutput.excludedPaths ?? [];
            output.skippedPaths = scanWorkflowOutput.skippedPaths ?? [];
        } catch (error) {
            if (wf.isCancellation(error) || wf.isCancellation(error?.cause)) {
                output.scanJobStatus = JobRunStatus.Stopped;
            } else {
                output.scanJobStatus = JobRunStatus.Failed;
            }
        }
        output.syncJobStatus = JobRunStatus.Stopped;
    } else if (stopRequested) {
        output.scanJobStatus = JobRunStatus.Stopped;
        output.syncJobStatus = JobRunStatus.Stopped;
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}
