import * as wf from '@temporalio/workflow';
import { getExternalWorkflowHandle } from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';


const {
  updateStatus: updateJobStatusActivity,
  
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});

const {
    isWorkflowRunningActivity: isWorkflowRunningActivity,
} = wf.proxyActivities<CommonTaskService>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '1m',
}); 


export const updateJobStatusIfNotRunning = async (state: JobRunStatus, jobRunId: string) => {
  if(state !== JobRunStatus.Running) {
    await updateJobStatusActivity({jobRunId, status: state});
  }
}

export const cancelWorkflowIfRunning = async (workflowId: string) =>{
  try{  
    const isWorkflowRunning  =  await isWorkflowRunningActivity(workflowId);
    if(!isWorkflowRunning){
      console.log(`${workflowId} is not running`);
      return;
    }          
    const handle = getExternalWorkflowHandle(workflowId);
    await handle.cancel();
    console.log(`${workflowId} is cancelled sucessfully`);
  }catch(error){
    console.log(`Failed to cancel workflow ${workflowId}`);
  }
    
}