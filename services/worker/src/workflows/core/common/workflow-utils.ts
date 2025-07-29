import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { LogExecutionTime } from '../../../utils/perfomance.test';


const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
});


export const updateJobStatusIfNotRunning = LogExecutionTime(async function updateJobStatusIfNotRunning(state: JobRunStatus, jobRunId: string) {
  if(state !== JobRunStatus.Running) {
    await updateJobStatusActivity({jobRunId, status: state});
  }
});
