import { startChild } from '@temporalio/workflow';
import { log } from '@temporalio/workflow';
import { LogGeneratorWorkflow } from './child-workflows/log-generator-workflow';

export const SupportBundleWorkflow = async ({ traceId, payload, options }) => {
  log.info('Started SupportBundleWorkflow');
  log.info(
    `Received arguments - traceId: ${traceId}, payload: ${JSON.stringify(payload)}, options: ${JSON.stringify(options)}`,
  );

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
    workflowResults.push(logGeneratorResult);
  } catch (err) {
    return {
      status: 'failed',
      message: 'Log generation failed. Skipping remaining workflows.',
      traceId,
      error: err.message,
    };
  }

  return {
    status: 'success',
    message: 'All child workflows completed successfully.',
    traceId,
    logGenerationOutput: workflowResults,
  };
};
