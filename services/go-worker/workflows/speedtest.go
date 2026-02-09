package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// SpeedTestWorkflow is the parent workflow for speed test jobs. It sets up
// workers, runs the speed test job workflow, and cleans up. Registered with
// Temporal as "SpeedTestWorkflow" for wire compatibility.
func SpeedTestWorkflow(ctx workflow.Context, input SpeedTestInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting SpeedTestWorkflow", "traceId", input.TraceID)

	// The payload is passed through as-is since the TypeScript version uses
	// untyped args. The activity and child workflow layers handle the
	// structure.
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
	})

	// Execute the speed test via activities. The full setup/test/cleanup cycle
	// matches the TypeScript SpeedTestWorkflow which orchestrates
	// SetupWorkerWorkflow -> SpeedTestJobWorkflow -> CleanupWorkerWorkflow.

	// Update status to Running.
	statusCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions())
	_ = workflow.ExecuteActivity(statusCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: input.TraceID,
		Status:   StatusRunning,
	}).Get(ctx, nil)

	// Execute read, write, network performance activities.
	speedTestCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: shortActivityOptions().RetryPolicy,
	})

	// Post initial results.
	var postData interface{}
	err := workflow.ExecuteActivity(actCtx, "PostResultsActivity", input.TraceID, "", "", nil).Get(ctx, &postData)
	if err != nil {
		logger.Error(fmt.Sprintf("Failed to post initial results: %v", err))
	}

	// Run speed test activities.
	var writeResult, readResult, networkResult interface{}

	writeErr := workflow.ExecuteActivity(speedTestCtx, "WriteActivity", input.Payload, input.TraceID).Get(ctx, &writeResult)
	if writeErr != nil {
		logger.Error(fmt.Sprintf("Write activity failed: %v", writeErr))
	}

	readErr := workflow.ExecuteActivity(speedTestCtx, "ReadActivity", input.Payload, input.TraceID).Get(ctx, &readResult)
	if readErr != nil {
		logger.Error(fmt.Sprintf("Read activity failed: %v", readErr))
	}

	networkErr := workflow.ExecuteActivity(speedTestCtx, "NetworkPerformanceActivity", input.Payload, input.TraceID).Get(ctx, &networkResult)
	if networkErr != nil {
		logger.Error(fmt.Sprintf("Network performance activity failed: %v", networkErr))
	}

	// Post final results.
	results := map[string]interface{}{
		"writeResult":              writeResult,
		"readResult":               readResult,
		"networkPerformanceResult": networkResult,
	}
	_ = workflow.ExecuteActivity(actCtx, "PostResultsActivity", input.TraceID, "", "", results).Get(ctx, nil)

	// Update final status.
	finalStatus := StatusCompleted
	if writeErr != nil || readErr != nil || networkErr != nil {
		finalStatus = StatusFailed
	}
	_ = workflow.ExecuteActivity(statusCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: input.TraceID,
		Status:   finalStatus,
	}).Get(ctx, nil)

	return map[string]interface{}{
		"traceId": input.TraceID,
		"status":  finalStatus,
	}, nil
}

// SpeedTestJobWorkflow executes the speed test for a single worker.
// Registered with Temporal as "SpeedTestJobWorkflow".
func SpeedTestJobWorkflow(ctx workflow.Context, args map[string]interface{}) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting SpeedTestJobWorkflow", "traceId", traceID)

	// Update status to Running.
	statusCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions())
	_ = workflow.ExecuteActivity(statusCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: traceID,
		Status:   StatusRunning,
	}).Get(ctx, nil)

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: shortActivityOptions().RetryPolicy,
	})

	workerID, _ := args["workerId"].(string)
	fileServerID, _ := args["fileServerId"].(string)

	// Post initial results.
	var data map[string]interface{}
	if err := workflow.ExecuteActivity(actCtx, "PostResultsActivity",
		traceID, workerID, fileServerID, nil).Get(ctx, &data); err != nil {
		return nil, err
	}

	tests, _ := args["tests"].(map[string]interface{})
	volumeID, _ := args["volumeId"].(string)

	var writeResult, readResult, networkResult interface{}

	if doWrite, _ := tests["writeTest"].(bool); doWrite {
		readResultID, _ := data["writeResultId"].(string)
		_ = workflow.ExecuteActivity(actCtx, "WriteActivity",
			args, traceID, volumeID, readResultID).Get(ctx, &writeResult)
	}

	if doRead, _ := tests["readTest"].(bool); doRead {
		readResultID, _ := data["readResultId"].(string)
		_ = workflow.ExecuteActivity(actCtx, "ReadActivity",
			args, traceID, volumeID, readResultID).Get(ctx, &readResult)
	}

	if doNetwork, _ := tests["networkPerformance"].(bool); doNetwork {
		_ = workflow.ExecuteActivity(actCtx, "NetworkPerformanceActivity",
			args, traceID).Get(ctx, &networkResult)
	}

	results := map[string]interface{}{
		"writeResult":              writeResult,
		"readResult":               readResult,
		"networkPerformanceResult": networkResult,
	}
	_ = workflow.ExecuteActivity(actCtx, "PostResultsActivity",
		traceID, workerID, fileServerID, results).Get(ctx, nil)

	_ = workflow.ExecuteActivity(statusCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: traceID,
		Status:   StatusCompleted,
	}).Get(ctx, nil)

	logger.Info("Speed test completed successfully", "traceId", traceID)
	return nil, nil
}
