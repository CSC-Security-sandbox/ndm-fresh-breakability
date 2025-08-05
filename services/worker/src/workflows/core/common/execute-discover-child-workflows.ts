import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';
import { ChildScanWorkflowOutput } from '../child/chid-scan.workflow.type';
import { cancelWorkflowIfRunning } from './workflow-utils';


interface DiscoveryWorkflowExecutorInput {
    jobRunId: string;
}

interface DiscoveryWorkflowExecutorOutput {
    status: JobRunStatus,
    fileCount : number;
    dirCount : number;
}


const {
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});


const actionSignal = wf.defineSignal<[string]>('action');

export const executeDiscoveryChildWorkflows = async ( {jobRunId } : DiscoveryWorkflowExecutorInput ) => {

    let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
    let isScanIsRunning: boolean = false;
    let output: DiscoveryWorkflowExecutorOutput = {
        status: JobRunStatus.Running,
        fileCount: 0,
        dirCount: 0,
    };


    wf.setHandler(actionSignal, async (action:string) => {  
        if(action == JobRunStatus.Stopped){
            await cancelWorkflowIfRunning(scanWorkflow.workflowId);
            return;
        }
        if(isScanIsRunning)    
            scanWorkflow.signal('scanActionSignal', action);    
    });

    scanWorkflow = await wf.startChild('ChildScanWorkflow', {
        args: [ { jobRunId,  isMigration: false } ],
        workflowId: `ScanWorkflow-${jobRunId}`,
        taskQueue: `${jobRunId}-TaskQueue`,
        cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: wf.ParentClosePolicy.TERMINATE,
    });
    isScanIsRunning = true;

    try{
        const scanWorkflowResult:ChildScanWorkflowOutput = await scanWorkflow.result()
        output.status = scanWorkflowResult.status;
        output.fileCount = scanWorkflowResult.fileCount;
        output.dirCount = scanWorkflowResult.dirCount;
    }catch(error) {
        if (wf.isCancellation(error.cause)) {
            // The workflow was cancelled
            output.status = JobRunStatus.Stopped;
        }else {
            console.log(`[${jobRunId}] Error in ChildScanWorkflow: ${error.message}`);
            output.status = JobRunStatus.Failed;
        }      
    }
    isScanIsRunning = false;
    await updateLastEntryActivity(jobRunId);
    return output;

}