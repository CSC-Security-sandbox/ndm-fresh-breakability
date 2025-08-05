import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { JobRunStatus } from "src/activities/common/enums";



const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
}); 



const {
    isWorkflowRunningActivity: isWorkflowRunningActivity,
} = wf.proxyActivities<CommonTaskService>({
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
        if(await isWorkflowRunningActivity(scanWorkflow.workflowId))
            await scanWorkflow.signal('scanActionSignal', action);    
        if(await isWorkflowRunningActivity(syncWorkflow.workflowId))
            await syncWorkflow.signal('syncActionSignal', action);
    });

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
        output.scanJobStatus = JobRunStatus.Failed; 
    }

    if(await isWorkflowRunningActivity(syncWorkflow.workflowId))
        await syncWorkflow.signal('scanResultSignal', output.scanJobStatus);

    try{
        const syncWorkflowOutput = await syncWorkflow.result(); 
        output.syncJobStatus = syncWorkflowOutput.status;    
    }catch(error){  
        output.syncJobStatus = JobRunStatus.Failed;
        await updateWorkerResponse(jobRunId, 'all', {
            status: 'FAILED',
            code: 'TASK_FETCH_FAILURE',
            operation: 'Sync Workflow Failed',
            occurrence: 1,
            origin: 'ChildSyncWorkflow',
            message: `Sync workflow failed with error: ${error.message}`,
            createdAt: new Date()
        });
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