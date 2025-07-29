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
    payload.zipLocation = logGeneratorResult;
    workflowResults.push(logGeneratorResult);

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
    workflowResults.push(errorCsvResult);

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
    workflowResults.push(configurationDataCsvResult);

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
