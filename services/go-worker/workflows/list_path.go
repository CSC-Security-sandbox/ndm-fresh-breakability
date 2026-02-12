package workflows

import (
	"encoding/json"
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// ListPathsWorkflow is the parent workflow that calls ListPathWorkerWorkflow
// for each worker ID.
//
// The function name MUST match the TypeScript export name exactly
// ("ListPathsWorkflow" with the trailing "s") because the Temporal Go SDK
// registers it under the function name, and the config service starts it by
// that string (WorkFlows.LIST_PATHS = 'ListPathsWorkflow').
func ListPathsWorkflow(ctx workflow.Context, input ListPathInput) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ListPathsWorkflow",
		"traceId", input.TraceID,
		"workerCount", len(input.Payload.WorkerIDs),
	)

	data := input.Payload

	if len(data.WorkerIDs) == 0 {
		logger.Warn("ListPathsWorkflow: no worker IDs in payload", "traceId", input.TraceID)
		return []interface{}{}, nil
	}

	logger.Info("ListPathsWorkflow payload",
		"traceId", input.TraceID,
		"workerIds", data.WorkerIDs,
		"hasFileServer", data.FileServer != nil,
	)

	// Execute a child workflow for each worker.
	// The TS workflow spreads `...options` into the child workflow start call,
	// which propagates workflowExecutionTimeout, workflowRunTimeout, etc.
	futures := make([]workflow.Future, len(data.WorkerIDs))
	for i, workerID := range data.WorkerIDs {
		childOpts := parseChildWorkflowOptions(
			fmt.Sprintf("ListPathsWorkflow-%s-%s", input.TraceID, workerID),
			fmt.Sprintf("%s-TaskQueue", workerID),
			input.Options,
		)
		childCtx := workflow.WithChildOptions(ctx, childOpts)

		logger.Info("Dispatching ListPathWorkerWorkflow",
			"traceId", input.TraceID,
			"workerID", workerID,
			"taskQueue", fmt.Sprintf("%s-TaskQueue", workerID),
		)

		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ListPathWorkerWorkflow", map[string]interface{}{
			"traceId":    data.TraceID,
			"fileServer": data.FileServer,
		})
	}

	var allResults []interface{}
	for i, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			logger.Error("Child workflow failed",
				"traceId", input.TraceID,
				"workerID", data.WorkerIDs[i],
				"error", err.Error(),
			)
			return nil, fmt.Errorf("child workflow for worker %s failed: %w", data.WorkerIDs[i], err)
		}

		logger.Info("Child workflow completed",
			"traceId", input.TraceID,
			"workerID", data.WorkerIDs[i],
		)

		if arr, ok := result.([]interface{}); ok {
			allResults = append(allResults, arr...)
		} else {
			allResults = append(allResults, result)
		}
	}

	logger.Info("ListPathsWorkflow completed",
		"traceId", input.TraceID,
		"resultCount", len(allResults),
	)
	return allResults, nil
}

// ListPathWorkerWorkflow lists available paths from a file server for a single
// worker. Registered with Temporal as "ListPathWorkerWorkflow".
//
// This mirrors the TypeScript ListPathWorkerWorkflow exactly:
//   - Receives {traceId, fileServer} from the parent workflow
//   - For each protocol in fileServer.protocols, calls the ListPaths activity
//     with (traceId, protocolType, {hostname, ...protocol})
//   - Returns the array of results from all protocol listings
func ListPathWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)

	argsJSON, _ := json.Marshal(args)
	logger.Info("Starting ListPathWorkerWorkflow",
		"traceId", traceID,
		"args", string(argsJSON),
	)

	fileServer, ok := args["fileServer"].(map[string]interface{})
	if !ok {
		logger.Error("ListPathWorkerWorkflow: fileServer is not a map",
			"traceId", traceID,
			"fileServerType", fmt.Sprintf("%T", args["fileServer"]),
		)
		return nil, fmt.Errorf("fileServer is not a map[string]interface{}, got %T", args["fileServer"])
	}

	protocolsRaw, ok := fileServer["protocols"].([]interface{})
	if !ok || len(protocolsRaw) == 0 {
		logger.Warn("ListPathWorkerWorkflow: no protocols found",
			"traceId", traceID,
		)
		return []interface{}{}, nil
	}

	logger.Info("ListPathWorkerWorkflow: processing protocols",
		"traceId", traceID,
		"protocolCount", len(protocolsRaw),
	)

	// TS uses: proxyActivities({ startToCloseTimeout: '30s' })
	actCtx := workflow.WithActivityOptions(ctx, listPathActivityOptions())

	futures := make([]workflow.Future, len(protocolsRaw))
	for i, pRaw := range protocolsRaw {
		protocol, _ := pRaw.(map[string]interface{})
		protocolType, _ := protocol["type"].(string)

		// Build the payload: { hostname: fileServer.hostname, ...protocol }
		listInput := map[string]interface{}{
			"hostname": fileServer["hostname"],
		}
		for k, v := range protocol {
			listInput[k] = v
		}

		logger.Info("Executing ListPaths activity",
			"traceId", traceID,
			"protocolType", protocolType,
			"hostname", fileServer["hostname"],
			"activityIndex", i,
		)

		// Call the activity with the same 3 positional args as the TS workflow:
		//   listPathActivity(traceId, protocolType, payload)
		futures[i] = workflow.ExecuteActivity(actCtx, "ListPaths",
			traceID, protocolType, listInput)
	}

	var results []interface{}
	for i, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			logger.Error("ListPaths activity failed",
				"traceId", traceID,
				"activityIndex", i,
				"error", err.Error(),
			)
			return nil, fmt.Errorf("ListPaths activity %d failed: %w", i, err)
		}
		logger.Info("ListPaths activity completed",
			"traceId", traceID,
			"activityIndex", i,
		)
		results = append(results, result)
	}

	logger.Info("ListPathWorkerWorkflow completed",
		"traceId", traceID,
		"resultCount", len(results),
	)
	return results, nil
}
