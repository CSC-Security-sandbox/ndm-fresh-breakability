import { startChild, log, proxyActivities } from '@temporalio/workflow';
import { LogGeneratorWorkflow } from './child-workflows/log-generator-workflow';
import { ErrorCsvGeneratorWorkflow } from './child-workflows/error-csv-generator-workflow';
import { SupportBundleStatus } from 'src/constants/enum';
import { ActivitiesService } from 'src/activities/activities.service';

const { notifyWorkflowCompletion } = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '1 minute',
});

export const SupportBundleWorkflow = async ({ traceId, payload, options }) => {
  log.info(`Started SupportBundleWorkflow for traceId: ${traceId}`);

  const workflowResults: string[] = [];

  try {
    // Step 1: Execute Log Generator Workflow
    log.info(`[${traceId}] Starting LogGeneratorWorkflow`);
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
    log.info(`[${traceId}] LogGeneratorWorkflow completed: ${JSON.stringify(logGeneratorResult)}`);

    // Extract zip path from result
    const zipPath = typeof logGeneratorResult === 'string'
      ? logGeneratorResult
      : logGeneratorResult?.message;

    if (!zipPath) {
      throw new Error('LogGeneratorWorkflow did not return a valid zip path');
    }

    payload.zipLocation = zipPath;
    workflowResults.push(zipPath);

    // Step 2: Execute Error CSV Generator Workflow
    log.info(`[${traceId}] Starting ErrorCsvGeneratorWorkflow`);
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
    log.info(`[${traceId}] ErrorCsvGeneratorWorkflow completed: ${JSON.stringify(errorCsvResult)}`);

    workflowResults.push(typeof errorCsvResult === 'string'
      ? errorCsvResult
      : (errorCsvResult?.message || 'CSV generation completed'));

    // Step 3: Notify successful completion
    try {
      await notifyWorkflowCompletion({
        traceId,
        status: SupportBundleStatus.COMPLETED,
        errorMessage: null,
      });
    } catch (notificationError) {
      log.error(`[${traceId}] Failed to send success notification: ${notificationError.message}`);
      // Don't fail the workflow for notification issues
    }

    return {
      status: 'success',
      message: 'All child workflows completed successfully.',
      traceId,
      workflowResults,
    };

  } catch (err) {
    log.error(`[${traceId}] Error in SupportBundleWorkflow: ${JSON.stringify(err)}`);

    // Extract detailed error information
    const errorMessage = err?.message || err?.toString() || 'Unknown workflow error';
    const errorDetails = {
      message: errorMessage,
      originalError: err,
      timestamp: new Date().toISOString(),
      traceId,
      workflowResults: workflowResults.length > 0 ? workflowResults : null
    };

    log.error(`[${traceId}] Detailed error context:`, errorDetails);

    // Notify failure with detailed error information
    try {
      await notifyWorkflowCompletion({
        traceId,
        status: SupportBundleStatus.FAILED,
        errorMessage: JSON.stringify(errorDetails), // Send complete error context
      });
    } catch (notificationError) {
      log.error(`[${traceId}] Failed to send failure notification: ${notificationError.message}`);
      // Log notification failure but don't change main error response
    }

    return {
      status: 'failed',
      message: 'Workflow failed during execution.',
      traceId,
      error: errorMessage,
      errorDetails,
    };
  }
};
