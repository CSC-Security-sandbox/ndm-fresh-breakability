import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from "src/activities/common/enums";
import { cancelWorkflowIfRunning, signalIfRunning } from './workflow-utils';




const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
}); 

const { updateWorkerResponse: updateWorkerResponse } = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '10m' });


export const actionSignal = wf.defineSignal<[string]>('action');

interface MigrationWorkflowExecutorInput {
    jobRunId: string;
}

interface MigrationWorkflowExecutorOutput {
    status: JobRunStatus,
    fileCount : number;
    dirCount : number;
    scanJobStatus: JobRunStatus;
    syncJobStatus: JobRunStatus;
}


export const executeMigrationChildWorkflows = async ({jobRunId}: MigrationWorkflowExecutorInput): Promise<MigrationWorkflowExecutorOutput> => {

    let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>, syncWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
    let output: MigrationWorkflowExecutorOutput = {
        status: JobRunStatus.Running,
        fileCount: 0,
        dirCount: 0,
        scanJobStatus: JobRunStatus.Running,
        syncJobStatus: JobRunStatus.Running,
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


        syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
            args: [ { jobRunId: jobRunId, isScanCompleted : false} ],
            workflowId: `SyncWorkflow-${jobRunId}`,
            taskQueue: `${jobRunId}-TaskQueue`,
            cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
        });


        try{
            const scanWorkflowOutput = await scanWorkflow.result(); 
            output.fileCount = scanWorkflowOutput.fileCount;
            output.dirCount = scanWorkflowOutput.dirCount;
            output.scanJobStatus = scanWorkflowOutput.status;    
        }catch(error){  
            if (wf.isCancellation(error.cause)) {
                // The workflow was cancelled
                output.scanJobStatus = JobRunStatus.Stopped;
            }else {
                output.scanJobStatus = JobRunStatus.Failed; 
            }
            syncWorkflow && await cancelWorkflowIfRunning(syncWorkflow.workflowId);
        }

        await signalIfRunning(syncWorkflow, 'scanResultSignal', output.scanJobStatus);
        try{
            const syncWorkflowOutput = await syncWorkflow.result(); 
            output.syncJobStatus = syncWorkflowOutput.status;    
        }catch(error){  
            if (wf.isCancellation(error.cause)) {
                // The workflow was cancelled
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
    }

    output.status = getUnifiedJobStatus(output.scanJobStatus, output.syncJobStatus);

    await updateLastEntryActivity(jobRunId);
    return output
}

const getUnifiedJobStatus = (scanStatus: JobRunStatus, syncStatus: JobRunStatus): JobRunStatus => {
    if (scanStatus === JobRunStatus.Failed || syncStatus === JobRunStatus.Failed) {
        return JobRunStatus.Failed;
    }
    if (scanStatus === JobRunStatus.Stopped || syncStatus === JobRunStatus.Stopped) {
        return JobRunStatus.Stopped;
    }
    return JobRunStatus.Completed; 
}