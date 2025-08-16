import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { fetchAndZipLogs } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '4h',
  retry: {
    maximumAttempts: 3,
    maximumInterval: '3s',
  },
});

export const LogGeneratorWorkflow = async ({ traceId, payload }) => {
  log.info(`[${traceId}] Started LogGeneratorWorkflow`);
  return await fetchAndZipLogs({ traceId, payload });
};
