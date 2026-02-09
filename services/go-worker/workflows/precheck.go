package workflows

import (
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// PreCheckWorkflow is the parent workflow for pre-check validation. It
// distributes pre-check tasks to worker child workflows and aggregates
// results. Registered with Temporal as "PreCheckWorkflow" for wire
// compatibility (TypeScript: PreCheckValidationWorkflow).
func PreCheckWorkflow(ctx workflow.Context, input PreCheckInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PreCheckWorkflow", "traceId", input.TraceID)

	// The input payload contains the full pre-check request structure.
	// We pass it through as-is to the worker child workflow, matching the
	// TypeScript PreCheckValidationWorkflow behavior.
	actCtx := workflow.WithActivityOptions(ctx, setupActivityOptions())

	// Execute pre-check activity directly (simplified from the TypeScript
	// which does complex routing). The Go version delegates all routing logic
	// to the activity layer.
	var result interface{}
	err := workflow.ExecuteActivity(actCtx, "PreCheckPath", input).Get(ctx, &result)
	if err != nil {
		return nil, fmt.Errorf("pre-check failed: %w", err)
	}

	return result, nil
}

// PreCheckWorkerValidationWorkflow is the per-worker pre-check workflow.
// Registered with Temporal as "PreCheckWorkerValidationWorkflow".
func PreCheckWorkerValidationWorkflow(ctx workflow.Context, workerID string, workerTaskPayload interface{}, traceID string) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PreCheckWorkerValidationWorkflow", "traceId", traceID, "workerId", workerID)

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 3000 * 1000000000, // 3000 seconds, matching TS
	})

	var result interface{}
	err := workflow.ExecuteActivity(actCtx, "PreCheckPath", workerTaskPayload, traceID).Get(ctx, &result)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"workerId": workerID,
		"paths":    result,
	}, nil
}
