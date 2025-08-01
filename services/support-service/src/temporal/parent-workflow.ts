import { startChild, log, proxyActivities } from '@temporalio/workflow';
import { LogGeneratorWorkflow } from './child-workflows/log-generator-workflow';
import { ErrorLogsCsvGeneratorWorkflow } from './child-workflows/error-csv-generator-workflow';
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
    const logGeneratorWorkflow = await startChild(LogGeneratorWorkflow, {
      args: [{ traceId, payload }],
      workflowId: `LogGeneratorWorkflow-${traceId}`,
    });

    const logGeneratorWorkflowResult = await logGeneratorWorkflow.result();

    log.info(`logGeneratorWorkflowResult - ${JSON.stringify(logGeneratorWorkflowResult)}`);
    if (!logGeneratorWorkflowResult.success) {
      log.info(`Error occured in LogGeneratorWorkflow: ${logGeneratorWorkflowResult.message}`);
      throw { message: logGeneratorWorkflowResult.message };
    }

    payload.zipLocation = logGeneratorWorkflowResult.message;
    workflowResults.push(logGeneratorWorkflowResult.message);

    const errorLogsCsvGeneratorWorkflow = await startChild(ErrorLogsCsvGeneratorWorkflow, {
      args: [{ traceId, payload }],
      workflowId: `ErrorCsvWorkflow-${traceId}`,
    });

    const errorLogsCsvGeneratorWorkflowResult = await errorLogsCsvGeneratorWorkflow.result();

    if (!errorLogsCsvGeneratorWorkflowResult.success) {
      log.info(`Error occured in ErrorCsvGeneratorWorkflow: ${errorLogsCsvGeneratorWorkflowResult.message}`);
      throw { message: errorLogsCsvGeneratorWorkflowResult.message };
    }

    workflowResults.push(errorLogsCsvGeneratorWorkflowResult.message);

    const configurationDataCsvGeneratorWorkflow = await startChild(
      ConfigurationDataCsvGeneratorWorkflow,
      {
        args: [{ traceId, payload }],
        workflowId: `ConfigurationDataCsvGeneratorWorkflow-${traceId}`,
      },
    );

    const configurationDataCsvGeneratorWorkflowResult = await configurationDataCsvGeneratorWorkflow.result();

    if (!configurationDataCsvGeneratorWorkflowResult.success) {
      log.info(`Error occured in ConfigurationDataCsvGeneratorWorkflow: ${configurationDataCsvGeneratorWorkflowResult.message}`);
      throw { message: configurationDataCsvGeneratorWorkflowResult.message };
    }

    workflowResults.push(configurationDataCsvGeneratorWorkflowResult.message);

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
