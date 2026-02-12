package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// CleanupWorkerWorkflow calls the cleanup activity to tear down a worker after
// a job run completes. Registered with Temporal as "CleanupWorkerWorkflow" for
// wire compatibility with the TypeScript version.
//
// TS uses: proxyActivities({ startToCloseTimeout: '300s' })
//
// The TS version takes untyped args and branches on jobType:
//   - Normal jobs: calls cleanup(args.jobRunId)
//   - Speed test: calls speedTestCleanup(args.jobRunId, args.fsDetails, args.protocolType)
func CleanupWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) error {
	logger := workflow.GetLogger(ctx)
	jobRunID, _ := args["jobRunId"].(string)
	logger.Info("Starting CleanupWorkerWorkflow", "jobRunId", jobRunID)

	// TS: proxyActivities({ startToCloseTimeout: '300s' })
	actCtx := workflow.WithActivityOptions(ctx, setupCleanupActivityOptions())

	// Check if this is a speed test cleanup.
	jobType, _ := args["jobType"].(string)
	if jobType == "SPEED_TEST" {
		// Speed test cleanup: pass jobRunId, fsDetails, protocolType.
		var result interface{}
		err := workflow.ExecuteActivity(actCtx, "SpeedTestCleanup", args).Get(ctx, &result)
		if err != nil {
			return err
		}
	} else {
		// Normal cleanup: just pass the jobRunId.
		var result interface{}
		err := workflow.ExecuteActivity(actCtx, "CleanupWorker", jobRunID).Get(ctx, &result)
		if err != nil {
			return err
		}
	}

	return nil
}
