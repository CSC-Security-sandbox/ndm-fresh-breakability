import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { generateSystemInventoryCsv } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '4h',
  retry: {
    maximumAttempts: 3,
    maximumInterval: '3s',
  },
});

export async function SystemInventoryCsvGeneratorWorkflow({
  traceId,
  payload,
}) {
  log.info(`[${traceId}] Started SystemInventoryCsvGeneratorWorkflow`);

  try {
    const systemInventoryCsv = await generateSystemInventoryCsv({
      traceId,
      payload,
    });
    log.info(
      `[${traceId}] Finished SystemInventoryCsvGeneratorWorkflow, systemInventoryCsv: ${systemInventoryCsv}`,
    );

    return {
      success: true,
      message:
        'Successfully generated system inventory CSV files for workers and jobs',
    };
  } catch (error) {
    log.error(
      `[${traceId}] Error in SystemInventoryCsvGeneratorWorkflow: ${error.message}`,
    );
    return {
      success: false,
      message: error.message,
    };
  }
}
