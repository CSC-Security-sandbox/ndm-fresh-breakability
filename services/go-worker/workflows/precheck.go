package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// PreCheckValidationWorkflow is the parent workflow for pre-check validation.
// It distributes pre-check tasks to worker child workflows and aggregates
// results.
//
// The function name matches the TypeScript "PreCheckValidationWorkflow".
// Note: This workflow is NOT started by the config service directly (it's not
// in the WorkFlows enum), but it can be started by other services.
//
// The TS version does complex in-memory routing:
//  1. Builds serverCredentials map and workerTasks map from payload
//  2. Dispatches PreCheckWorkerValidationWorkflow for each healthy worker
//  3. Aggregates results and maps failures back to source/destination paths
//
// The Go version passes the full payload to worker children and lets them
// handle the pre-check logic via the PreCheckPath activity.
func PreCheckValidationWorkflow(ctx workflow.Context, input PreCheckInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PreCheckValidationWorkflow", "traceId", input.TraceID)

	payload, ok := input.Payload.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for PreCheckValidationWorkflow")
	}

	// Extract worker IDs from the pre-check payload.
	// The TS version builds worker IDs from payload.preChecks[].destinations[].workers[].
	// For simplicity, we extract all unique healthy workers.
	preChecks, _ := payload["preChecks"].([]interface{})
	serverCredentials, _ := payload["serverCredentials"].([]interface{})

	// Build a set of unique healthy worker IDs.
	workerSet := make(map[string]bool)
	for _, pcRaw := range preChecks {
		pc, _ := pcRaw.(map[string]interface{})
		destinations, _ := pc["destinations"].([]interface{})
		for _, dRaw := range destinations {
			d, _ := dRaw.(map[string]interface{})
			workers, _ := d["workers"].([]interface{})
			for _, wRaw := range workers {
				w, _ := wRaw.(map[string]interface{})
				workerID, _ := w["workerId"].(string)
				isHealthy, _ := w["ishealthy"].(bool)
				if workerID != "" && isHealthy {
					workerSet[workerID] = true
				}
			}
		}
	}

	workerIDs := make([]string, 0, len(workerSet))
	for wID := range workerSet {
		workerIDs = append(workerIDs, wID)
	}

	if len(workerIDs) == 0 {
		logger.Warn("PreCheckValidationWorkflow: no healthy workers found")
		return []interface{}{}, nil
	}

	// Dispatch PreCheckWorkerValidationWorkflow for each worker.
	// TS passes: (workerId, { serverCredentials, serverPaths, settings }, traceId)
	futures := make([]workflow.Future, len(workerIDs))
	for i, workerID := range workerIDs {
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("PreCheckValidationWorkflow-%s-%s", input.TraceID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "PreCheckWorkerValidationWorkflow",
			workerID,
			map[string]interface{}{
				"serverCredentials": serverCredentials,
				"serverPaths":       preChecks,
				"settings":          payload["settings"],
			},
			input.TraceID,
		)
	}

	// Collect results from all workers.
	var allResults []interface{}
	for _, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			logger.Error(fmt.Sprintf("PreCheckWorkerValidationWorkflow failed: %v", err))
			continue
		}
		allResults = append(allResults, result)
	}

	return allResults, nil
}

// PreCheckWorkerValidationWorkflow is the per-worker pre-check workflow.
// Registered with Temporal as "PreCheckWorkerValidationWorkflow".
//
// TS uses: proxyActivities({ startToCloseTimeout: '3000s' })
func PreCheckWorkerValidationWorkflow(ctx workflow.Context, workerID string, workerTaskPayload interface{}, traceID string) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PreCheckWorkerValidationWorkflow", "traceId", traceID, "workerId", workerID)

	// TS: proxyActivities({ startToCloseTimeout: '3000s' })
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 3000 * time.Second,
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
