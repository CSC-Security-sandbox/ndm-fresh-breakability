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
            try {
                scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId);
                syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
                output.status = JobRunStatus.Stopped;
                output.scanJobStatus = JobRunStatus.Stopped;
                output.syncJobStatus = JobRunStatus.Stopped;
            } catch (error) {
                console.error(`[${jobRunId}] Failed to cancel child workflows on stop: ${error.message}`);
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

    if(output.status !== JobRunStatus.Stopped && output.status !== JobRunStatus.Failed){
        scanWorkflow = await wf.startChild('ChildScanWorkflow', {
            args: [ { jobRunId: jobRunId, failedWorkers: [] , isMigration: true } ],
            workflowId: `ScanWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if(output.status !== JobRunStatus.Stopped && output.status !== JobRunStatus.Failed){
        syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
            args: [ { jobRunId: jobRunId, scanWorkflowStatus: JobRunStatus.Running } ],
            workflowId: `SyncWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });
    }

    if(output.status !== JobRunStatus.Stopped && output.status !== JobRunStatus.Failed){
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
            }else {
                output.scanJobStatus = JobRunStatus.Failed; 
            }
            try { syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId); }
            catch (cancelErr) { console.error(`[${jobRunId}] Failed to cancel sync workflow after scan failure: ${cancelErr.message}`); }
        }

        try {
            await signalIfRunning(syncWorkflow, 'scanResultSignal', output.scanJobStatus);
        } catch (error) {
            console.error(`[${jobRunId}] Failed to send scanResultSignal to sync workflow: ${error.message}`);
            output.scanJobStatus = JobRunStatus.Failed;
            output.syncJobStatus = JobRunStatus.Failed;
            output.status = JobRunStatus.Failed;
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

        if(syncWorkflow && output.status !== JobRunStatus.Failed){
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
                try { scanWorkflow && await cancelWorkflowIfRunning(scanWorkflow.workflowId); }
                catch (cancelErr) { console.error(`[${jobRunId}] Failed to cancel scan workflow after sync failure: ${cancelErr.message}`); }
            }
        }
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}