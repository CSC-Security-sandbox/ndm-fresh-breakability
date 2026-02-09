package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// CleanupWorkerWorkflow calls the cleanup activity to tear down a worker after
// a job run completes. Registered with Temporal as "CleanupWorkerWorkflow" for
// wire compatibility with the TypeScript version.
func CleanupWorkerWorkflow(ctx workflow.Context, input CleanupWorkerInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting CleanupWorkerWorkflow", "jobRunId", input.JobRunID)

	actCtx := workflow.WithActivityOptions(ctx, setupActivityOptions())

	var result interface{}
	err := workflow.ExecuteActivity(actCtx, "CleanupWorker", input.JobRunID).Get(ctx, &result)
	if err != nil {
		return err
	}

	return nil
}
