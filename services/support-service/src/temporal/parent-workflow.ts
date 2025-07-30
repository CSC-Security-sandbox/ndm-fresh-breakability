import { startChild, log, proxyActivities } from '@temporalio/workflow';
import { LogGeneratorWorkflow } from './child-workflows/log-generator-workflow';
import { ErrorCsvGeneratorWorkflow } from './child-workflows/error-csv-generator-workflow';
import { SupportBundleStatus } from 'src/constants/enum';
import { ActivitiesService } from 'src/activities/activities.service';
import { ConfigurationDataCsvGeneratorWorkflow } from './child-workflows/configuration-data-csv-workflow';

const { notifyWorkflowCompletion } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '1 minute',
});

export const SupportBundleWorkflow = async ({ traceId, payload, options }) => {
  log.info(`Started SupportBundleWorkflow for traceId: ${traceId}`);

  const workflowResults: string[] = [];

  try {
    const logGeneratorChild = await startChild(LogGeneratorWorkflow, {
      args: [{ traceId, payload }],
      workflowId: `LogGeneratorWorkflow-${traceId}`,
      retry: {
        maximumAttempts: 3,
        initialInterval: '2s',
      },
      workflowExecutionTimeout: '30s',
    });

    const logGeneratorResult = await logGeneratorChild.result();

    log.info(`logGeneratorResult - ${JSON.stringify(logGeneratorResult)}`);
    if (logGeneratorResult.status === 'failed') {
      log.info(`error occured in LogGeneratorWorkflow: ${logGeneratorResult.message}`);
      // Throw a plain object to preserve the message in Temporal's error serialization
      throw { message: logGeneratorResult.message };
    }

    payload.zipLocation = logGeneratorResult.message;
    workflowResults.push(logGeneratorResult.message);

    const errorCsvChild = await startChild(ErrorCsvGeneratorWorkflow, {
      args: [{ traceId, payload }],
      workflowId: `ErrorCsvWorkflow-${traceId}`,
      retry: {
        maximumAttempts: 3,
        initialInterval: '2s',
      },
      workflowExecutionTimeout: '3m',
    });

    const errorCsvResult = await errorCsvChild.result();

    if (errorCsvResult.status === 'failed') {
      log.info(`error occured in ErrorCsvGeneratorWorkflow: ${errorCsvResult.message}`);
      // Throw a plain object to preserve the message in Temporal's error serialization
      throw { message: errorCsvResult.message };
    }

    workflowResults.push(errorCsvResult.message);

    const configurationDataCsvChild = await startChild(
      ConfigurationDataCsvGeneratorWorkflow,
      {
        args: [{ traceId, payload }],
        workflowId: `ConfigurationDataCsvWorkflow-${traceId}`,
        retry: {
          maximumAttempts: 3,
          initialInterval: '2s',
        },
        workflowExecutionTimeout: '3m',
      },
    );

    const configurationDataCsvResult = await configurationDataCsvChild.result();

    if (configurationDataCsvResult.status === 'failed') {
      log.info(`error occured in ConfigurationDataCsvGeneratorWorkflow: ${configurationDataCsvResult.message}`);
      // Throw a plain object to preserve the message in Temporal's error serialization
      throw { message: configurationDataCsvResult.message };
    }

    workflowResults.push(configurationDataCsvResult.message);

    await notifyWorkflowCompletion({
      traceId,
      status: SupportBundleStatus.COMPLETED,
      errorMessage: null,
    });

    return {
      status: 'success',
      message: 'All child workflows completed successfully.',
      traceId,
      workflowResults,
    };
  } catch (err) {
    log.error(`Error in SupportBundleWorkflow for traceId: ${traceId} ${JSON.stringify(err)}`);
    await notifyWorkflowCompletion({
      traceId,
      status: SupportBundleStatus.FAILED,
      errorMessage: err.message,
    });

    return {
      status: 'failed',
      message: 'Workflow failed during execution.',
      traceId,
      error: err.message,
    };
  }
};
