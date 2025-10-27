import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';
import { WORKFLOW_TIMEOUTS } from '../../constants/constants';

const { generateErrorCsv } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: WORKFLOW_TIMEOUTS.ACTIVITY_TIMEOUT,
  retry: {
    maximumAttempts: 3,
    maximumInterval: '3s',
  },
});

export const ErrorLogsCsvGeneratorWorkflow = async ({ traceId, payload }) => {
  log.info(`[${traceId}] Starting Error Logs CSV Generation`);

  try {
    const result = await generateErrorCsv({ traceId, payload });

    // Check if the activity itself returned a failure status
    if (result && !result.success) {
      throw new Error(`CSV Generation failed: ${result.message}`);
    }

    log.info(`[${traceId}] Finished Error CSV Generation`);

    return {
      success: true,
      message:
        result?.message || 'Successfully Completed Error logs CSV Generation',
    };
  } catch (error) {
    log.error(
      `[${traceId}] Error during Error logs CSV generation: ${error.message}`,
    );
    return {
      success: false,
      message: error.message,
    };
  }
};
