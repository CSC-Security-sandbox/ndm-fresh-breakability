import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { getJobConfigIdsByProjectIds, generateErrorCsv } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '1 minute',
  });

export const ErrorCsvGeneratorWorkflow = async ({ traceId, payload }) => {
  log.info(`[${traceId}] Starting Error CSV Generation`);

  try {
    const projectIds = await getJobConfigIdsByProjectIds({ traceId, payload });

    await generateErrorCsv({ traceId, projectIds, payload });

    log.info(`[${traceId}] Finished Error CSV Generation`);
    return `Successfully Completed Error CSV Generation`;
  } catch (error) {
    log.error(`[${traceId}] Error during CSV generation: ${error.message}`);
    throw error;
  }
};
