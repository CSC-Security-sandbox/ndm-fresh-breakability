package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// SetupWorkerWorkflow calls the setup activity to prepare a worker for a job
// run. Registered with Temporal as "SetupWorkerWorkflow" for wire
// compatibility with the TypeScript version.
func SetupWorkerWorkflow(ctx workflow.Context, input SetupWorkerInput) (*SetupWorkerOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting SetupWorkerWorkflow", "jobRunId", input.JobRunID)

	actCtx := workflow.WithActivityOptions(ctx, setupActivityOptions())

	var result SetupWorkerOutput
	err := workflow.ExecuteActivity(actCtx, "SetupWorker", input.JobRunID).Get(ctx, &result)
	if err != nil {
		return nil, err
	}

	return &result, nil
}
