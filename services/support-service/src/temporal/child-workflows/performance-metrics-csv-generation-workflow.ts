import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { generatePerformanceMetricsCsv } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '4h',
  retry: {
    maximumAttempts: 3,
    maximumInterval: '3s',
  },
});

export async function PerformanceMetricsCsvGeneratorWorkflow({
  traceId,
  payload,
}) {
  log.info(`[${traceId}] Started PerformanceMetricsCsvGeneratorWorkflow`);

  try {
    const performanceMetricsCsv = await generatePerformanceMetricsCsv({
      traceId,
      payload,
    });
    log.info(
      `[${traceId}] Finished PerformanceMetricsCsvGeneratorWorkflow, performanceMetricsCsv: ${performanceMetricsCsv}`,
    );

    return {
      success: true,
      message:
        'Successfully generated performance metrics CSV file',
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
