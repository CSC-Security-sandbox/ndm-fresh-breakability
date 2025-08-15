import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { generateConfigurationDataCsv, generateConfigurationJobCsv } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '4h',
    retry: {
      maximumAttempts: 3,
      maximumInterval: '3s',
    },
  });

export const ConfigurationDataCsvGeneratorWorkflow = async ({
  traceId,
  payload,
}) => {
  log.info(`[${traceId}] Started ConfigurationDataCsvGeneratorWorkflow`);

  try {
    const configWorkerCsv = await generateConfigurationDataCsv({
      traceId,
      payload,
    });
    log.info(
      `[${traceId}] Finished ConfigurationDataCsvGeneratorWorkflow, configWorkerCsv: ${configWorkerCsv}`,
    );

    const configJobCsv = await generateConfigurationJobCsv({
      traceId,
      payload,
    });
    log.info(
      `[${traceId}] Finished ConfigurationDataCsvGeneratorWorkflow, configJobCsv: ${configJobCsv}`,
    );

    return {
      success: true,
      message:
        'Successfully generated configuration data CSV files for workers and jobs',
    };
  } catch (error) {
    log.error(
      `[${traceId}] Error in ConfigurationDataCsvGeneratorWorkflow: ${error.message}`,
    );
    return {
      success: false,
      message: error.message,
    };
  }
};
