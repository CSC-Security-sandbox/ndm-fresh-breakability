package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// SetupWorkerWorkflow calls the setup activity to prepare a worker for a job
// run. Registered with Temporal as "SetupWorkerWorkflow" for wire
// compatibility with the TypeScript version.
//
// TS uses: proxyActivities({ startToCloseTimeout: '300s' })
//
// The TS version takes untyped args and branches on jobType:
//   - Normal jobs: calls setup(args.jobRunId)
//   - Speed test: calls speedTestSetup(params) with full file server details
//
// For Go, the config service always dispatches this as a child workflow
// from the parent (executeWorkerSetup or SpeedTestWorkflow), so the input
// shape depends on the caller. We accept a generic map to handle both cases.
func SetupWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) (*SetupWorkerOutput, error) {
	logger := workflow.GetLogger(ctx)
	jobRunID, _ := args["jobRunId"].(string)
	logger.Info("Starting SetupWorkerWorkflow", "jobRunId", jobRunID)

	// TS: proxyActivities({ startToCloseTimeout: '300s' })
	actCtx := workflow.WithActivityOptions(ctx, setupCleanupActivityOptions())

	// Check if this is a speed test job.
	isSpeedTest := false
	if fileServer, ok := args["fileServer"].(map[string]interface{}); ok {
		if jobConfig, ok := fileServer["jobConfig"].(map[string]interface{}); ok {
			if jobType, _ := jobConfig["jobType"].(string); jobType == "SPEED_TEST" {
				isSpeedTest = true
			}
		}
	}

	var result SetupWorkerOutput
	if isSpeedTest {
		// Speed test setup: pass the full args to SpeedTestSetup activity.
		err := workflow.ExecuteActivity(actCtx, "SpeedTestSetup", args).Get(ctx, &result)
		if err != nil {
			return nil, err
		}
	} else {
		// Normal setup: just pass the jobRunId.
		err := workflow.ExecuteActivity(actCtx, "SetupWorker", jobRunID).Get(ctx, &result)
		if err != nil {
			return nil, err
		}
	}

	return &result, nil
}
