import { startChild } from '@temporalio/workflow';
import { log } from '@temporalio/workflow';
import { LogGeneratorWorkflow } from './child-workflows/log-generator-workflow';

export const SupportBundleWorkflow = async ({ traceId, payload, options }) => {
  log.info('Started Parent Workflow');
  log.info(
    `Args getting to parent - ${traceId}, ${JSON.stringify(payload)}, ${options}`,
  );
  const childResults: string[] = [];

  try {
    const child1 = await startChild(LogGeneratorWorkflow, {
      args: [{ traceId, payload }],
      workflowId: `LogGeneratorWorkflow-${traceId}`,
      retry: {
        maximumAttempts: 3,
        initialInterval: '2s',
      },
      workflowExecutionTimeout: '30s',
    });

    const result1 = await child1.result();
    childResults.push(result1);
  } catch (err) {
    return {
      message: 'LogGeneratorWorkflow failed, skipping all others.',
      error: err.message,
    };
  }

  return {
    message: 'Child workflows completed successfully',
    results: childResults,
  };
};
