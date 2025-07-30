import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { fetchAndZipLogs } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '1 minute',
  });

export const LogGeneratorWorkflow = async ({ traceId, payload }) => {
  log.info(`[${traceId}] Started LogGeneratorWorkflow`);

  try {
    const zipPath = await fetchAndZipLogs({ traceId, payload });
    log.info(`[${traceId}] Finished LogGeneratorWorkflow, zipPath: ${zipPath}`);

    return {
      status: 'success',
      message: zipPath,
    };

  } catch (error) {
    log.error(`[${traceId}] Error in LogGeneratorWorkflow: ${error.message}`);
    // Don't return status object - throw the error so parent can catch it
    throw error;
  }
};
