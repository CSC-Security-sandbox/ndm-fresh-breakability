import { proxyActivities } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { fetchAndZipLogsUsingFind } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '1 minute',
});

export const LogGeneratorWorkflow = async ({ traceId, payload }) => {
  console.log(`Started LogGeneratorWorkflow Child workflow - ${traceId}`);
  return await fetchAndZipLogsUsingFind({ traceId, payload });
};
