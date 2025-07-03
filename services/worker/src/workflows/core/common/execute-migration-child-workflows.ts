import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from "src/activities/discovery/enums";



const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
}); 


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
    let isScanRunning: boolean = false, isSyncRunning: boolean = false, isStopped: boolean = false;
    let output: MigrationWorkflowExecutorOutput = {
        status: JobRunStatus.Running,
        fileCount: 0,
        dirCount: 0,
        scanJobStatus: JobRunStatus.Running,
        syncJobStatus: JobRunStatus.Running,
    };

    wf.setHandler(actionSignal, async (action:string) => {  
        isStopped = action === JobRunStatus.Stopped
        if(isScanRunning)    
            scanWorkflow.signal('scanActionSignal', action);    
        if(isSyncRunning)
            syncWorkflow.signal('syncActionSignal', action);
    });

    scanWorkflow = await wf.startChild('ChildScanWorkflow', {
        args: [ { jobRunId: jobRunId, failedWorkers: [] , isMigration: true } ],
        workflowId: `ScanWorkflow-${jobRunId}`,
        taskQueue: `${jobRunId}-TaskQueue`,
        cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });
    isScanRunning = true;

    syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
        args: [ { jobRunId: jobRunId, isScanCompleted : false} ],
        workflowId: `SyncWorkflow-${jobRunId}`,
        taskQueue: `${jobRunId}-TaskQueue`,
        cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });
    isSyncRunning = true;

    try{
        const scanWorkflowOutput = await scanWorkflow.result(); 
        output.fileCount = scanWorkflowOutput.fileCount;
        output.dirCount = scanWorkflowOutput.dirCount;
        output.scanJobStatus = scanWorkflowOutput.status;
        if(!isStopped)
            syncWorkflow.signal('scanResultSignal', JobRunStatus.Completed);      
    }catch(error){  
        output.scanJobStatus = JobRunStatus.Failed;
        if(!isStopped)
            syncWorkflow.signal('scanResultSignal', JobRunStatus.Failed);
    }
    isScanRunning = false; 

    try{
        const scanWorkflowOutput = await scanWorkflow.result(); 
        output.syncJobStatus = scanWorkflowOutput.status;    
    }catch(error){  
        output.syncJobStatus = JobRunStatus.Failed;
    }
    isSyncRunning = false

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