import { proxyActivities } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';
import { SupportBundleStatus } from 'src/constants/enum';

const { fetchAndZipLogs, notifyWorkflowCompletion } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '1 minute',
  });

export const LogGeneratorWorkflow = async ({ traceId, payload }) => {
  console.log(`Started LogGeneratorWorkflow - ${traceId}`);

  try {
    const zipPath = await fetchAndZipLogs({ traceId, payload });

    await notifyWorkflowCompletion({
      traceId,
      status: SupportBundleStatus.COMPLETED,
    });

    return zipPath;
  } catch (error) {
    await notifyWorkflowCompletion({
      traceId,
      status: SupportBundleStatus.FAILED,
    });

    throw error;
  }
};
