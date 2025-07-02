
import * as wf from '@temporalio/workflow';
import { ChildWorkflowCancellationType, ParentClosePolicy } from "@temporalio/workflow";
import { ScanWorkflowOutput, ScanWorkflowStatus, SyncWorkflowOutput, WorkflowStatus } from '../chid-scan.workflow.type';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { CommonActivityService } from 'src/activities/common/common.service';
import { scan } from 'rxjs';
import { trace } from 'console';


const {
  updateStatus: updateJobStatusActivity,
  updateLastEntry: updateLastEntryActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});


export async function orchestrateChildWorkflows(traceId: string, action_signal: wf.SignalDefinition<[string], string> ): Promise<WorkflowStatus>{

  // failedStatus is true if any of the child workflows failed, else false.
  let isScanRunning = true; 
  let isSyncRunning = false;
  let failedStatus  = false;
  let scanWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
  let syncWorkflow: wf.ChildWorkflowHandle<wf.Workflow>;
   let scanWorkflowOutput: ScanWorkflowOutput = {
      jobRunId: traceId,
      fileCount: 0,
      dirCount: 0,
      status: JobRunStatus.Running,
      error: undefined,
    };
  
  let syncWorkflowOutput: SyncWorkflowOutput = {
        jobRunId: traceId,
        status: JobRunStatus.Ready,
    }
  let orchestrationOutput: WorkflowStatus = WorkflowStatus.Completed;

  wf.setHandler(action_signal, async (action:string) => {  
    if(isScanRunning)    
      scanWorkflow.signal('scanActionSignal', action);    
    if(isSyncRunning)
      syncWorkflow.signal('syncActionSignal', action);
    
  });
  scanWorkflow = await wf.startChild('ChildScanWorkflow', {
    args: [ { jobRunId: traceId, failedWorkers: [] , isMigration: true } ],
    workflowId: `ScanWorkflow-${traceId}`,
    taskQueue: `${traceId}-TaskQueue`,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  });
  isScanRunning = true;
  syncWorkflow = await wf.startChild('ChildSyncWorkflow', {
    args: [ { jobRunId: traceId, isScanCompleted : false, scanWorkflowResult: ScanWorkflowStatus.Running} ],
    workflowId: `SyncWorkflow-${traceId}`,
    taskQueue: `${traceId}-TaskQueue`,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  });
  isSyncRunning = true;

   try{
    scanWorkflowOutput = await scanWorkflow.result(); 
    syncWorkflow.signal('scanResultSignal', ScanWorkflowStatus.Completed);      
  }catch(error){  
      failedStatus = true;         
      syncWorkflow.signal('scanResultSignal', ScanWorkflowStatus.Failed);
  }
  isScanRunning = false; 
  try{
    syncWorkflowOutput = await syncWorkflow.result();
  }catch(error){
    failedStatus= true;
  }
  isSyncRunning = false;
  
  if(scanWorkflowOutput.status === JobRunStatus.Stopped || syncWorkflowOutput.status === JobRunStatus.Stopped) {
    orchestrationOutput = WorkflowStatus.Stopped;
  }else if(scanWorkflowOutput.status === JobRunStatus.Failed || syncWorkflowOutput.status === JobRunStatus.Failed || failedStatus) {
    orchestrationOutput = WorkflowStatus.Failed;
  }
  await updateLastEntryActivity(traceId);

  return orchestrationOutput;
}


export const updateJobStatusIfNotRunning = async (state: JobRunStatus, jobRunId: string) => {
  if(state !== JobRunStatus.Running) {
    await updateJobStatusActivity({jobRunId, status: state});
  }
}
