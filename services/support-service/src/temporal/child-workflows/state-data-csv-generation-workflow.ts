import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { generateStateDataCsv } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '4h',
  retry: {
    maximumAttempts: 3,
    maximumInterval: '3s',
  },
});

export async function StateDataCsvGeneratorWorkflow({ traceId, payload }) {
  log.info(`[${traceId}] Started StateDataCsvGeneratorWorkflow`);

  try {
    const stateDataCsv = await generateStateDataCsv({
      traceId,
      payload,
    });
    log.info(
      `[${traceId}] Finished StateDataCsvGeneratorWorkflow, stateDataCsv: ${stateDataCsv}`,
    );

    return {
      success: true,
      message:
        'Successfully generated state data CSV files for workers and jobs',
    };
  } catch (error) {
    log.error(
      `[${traceId}] Error in StateDataCsvGeneratorWorkflow: ${error.message}`,
    );
    return {
      success: false,
      message: error.message,
    };
  }
}
