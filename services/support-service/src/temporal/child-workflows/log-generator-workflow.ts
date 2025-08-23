import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';
import { WORKFLOW_TIMEOUTS } from '../../constants/constants';

const { fetchAndZipLogs } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: WORKFLOW_TIMEOUTS.ACTIVITY_TIMEOUT,
  retry: {
    maximumAttempts: 3,
    maximumInterval: '3s',
  },
});

export const LogGeneratorWorkflow = async ({ traceId, payload }) => {
  log.info(`[${traceId}] Started LogGeneratorWorkflow`);
  return await fetchAndZipLogs({ traceId, payload });
};
