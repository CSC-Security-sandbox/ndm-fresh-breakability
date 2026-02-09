package workflows

import (
	"encoding/json"
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// ValidateConnectionsWorkflow is the parent workflow that calls
// ValidateWorkerConnectionWorkflow for each worker ID.
//
// The function name MUST match the TypeScript export name exactly
// ("ValidateConnectionsWorkflow" with the trailing "s") because the
// Temporal Go SDK registers it under the function name, and the config
// service starts it by that string (WorkFlows.VALIDATE_CONNECTION =
// 'ValidateConnectionsWorkflow').
func ValidateConnectionsWorkflow(ctx workflow.Context, input ValidateConnectionInput) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ValidateConnectionsWorkflow",
		"traceId", input.TraceID,
		"workerCount", len(input.Payload.WorkerIDs),
	)

	// The config service wraps the real data inside input.Payload.
	data := input.Payload

	if len(data.WorkerIDs) == 0 {
		logger.Warn("ValidateConnectionsWorkflow: no worker IDs in payload", "traceId", input.TraceID)
		return []interface{}{}, nil
	}

	// Log the payload summary for debugging.
	logger.Info("ValidateConnectionsWorkflow payload",
		"traceId", input.TraceID,
		"workerIds", data.WorkerIDs,
		"hasFileServer", data.FileServer != nil,
		"hasFeature", data.Feature != nil,
	)

	// Execute a child workflow for each worker.
	futures := make([]workflow.Future, len(data.WorkerIDs))
	for i, workerID := range data.WorkerIDs {
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("ValidateConnectionsWorkflow-%s-%s", input.TraceID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})

		logger.Info("Dispatching child workflow",
			"traceId", input.TraceID,
			"workerID", workerID,
			"taskQueue", fmt.Sprintf("%s-TaskQueue", workerID),
		)

		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ValidateWorkerConnectionWorkflow", map[string]interface{}{
			"traceId":    data.TraceID,
			"fileServer": data.FileServer,
			"feature":    data.Feature,
		})
	}

	// Collect results.
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

		// Flatten arrays from each worker.
		if arr, ok := result.([]interface{}); ok {
			allResults = append(allResults, arr...)
		} else {
			allResults = append(allResults, result)
		}
	}

	logger.Info("ValidateConnectionsWorkflow completed",
		"traceId", input.TraceID,
		"resultCount", len(allResults),
	)
	return allResults, nil
}

// ValidateWorkerConnectionWorkflow validates connectivity for a single worker
// by calling the ValidateConnection activity for each protocol. Registered with
// Temporal as "ValidateWorkerConnectionWorkflow".
//
// This mirrors the TypeScript ValidateWorkerConnectionWorkflow exactly:
//   - Receives {traceId, fileServer, feature} from the parent workflow
//   - For each protocol in fileServer.protocols, calls the ValidateConnection
//     activity with (traceId, protocolType, {hostname, ...protocol}, feature)
//   - Returns the array of results from all protocol validations
func ValidateWorkerConnectionWorkflow(ctx workflow.Context, args map[string]interface{}) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)

	// Log the raw args for debugging.
	argsJSON, _ := json.Marshal(args)
	logger.Info("Starting ValidateWorkerConnectionWorkflow",
		"traceId", traceID,
		"args", string(argsJSON),
	)

	fileServer, ok := args["fileServer"].(map[string]interface{})
	if !ok {
		logger.Error("ValidateWorkerConnectionWorkflow: fileServer is not a map",
			"traceId", traceID,
			"fileServerType", fmt.Sprintf("%T", args["fileServer"]),
		)
		return nil, fmt.Errorf("fileServer is not a map[string]interface{}, got %T", args["fileServer"])
	}

	feature, _ := args["feature"].(map[string]interface{})
	if feature == nil {
		// Default to empty feature map if not provided.
		feature = map[string]interface{}{}
	}

	protocolsRaw, ok := fileServer["protocols"].([]interface{})
	if !ok || len(protocolsRaw) == 0 {
		logger.Warn("ValidateWorkerConnectionWorkflow: no protocols found",
			"traceId", traceID,
		)
		return []interface{}{}, nil
	}

	logger.Info("ValidateWorkerConnectionWorkflow: processing protocols",
		"traceId", traceID,
		"protocolCount", len(protocolsRaw),
	)

	actCtx := workflow.WithActivityOptions(ctx, setupActivityOptions())

	futures := make([]workflow.Future, len(protocolsRaw))
	for i, pRaw := range protocolsRaw {
		protocol, _ := pRaw.(map[string]interface{})
		protocolType, _ := protocol["type"].(string)

		// Build the payload: { hostname: fileServer.hostname, ...protocol }
		// This matches the TS workflow: { hostname: fileServer.hostname, ...protocol }
		validateInput := map[string]interface{}{
			"hostname": fileServer["hostname"],
		}
		for k, v := range protocol {
			validateInput[k] = v
		}

		logger.Info("Executing ValidateConnection activity",
			"traceId", traceID,
			"protocolType", protocolType,
			"hostname", fileServer["hostname"],
			"activityIndex", i,
		)

		// Call the activity with the same 4 positional args as the TS workflow:
		//   validateActivity(traceId, protocolType, payload, feature)
		// The Go SDK maps these to the activity method parameters after ctx.
		futures[i] = workflow.ExecuteActivity(actCtx, "ValidateConnection",
			traceID, protocolType, validateInput, feature)
	}

	var results []interface{}
	for i, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			logger.Error("ValidateConnection activity failed",
				"traceId", traceID,
				"activityIndex", i,
				"error", err.Error(),
			)
			return nil, fmt.Errorf("ValidateConnection activity %d failed: %w", i, err)
		}
		logger.Info("ValidateConnection activity completed",
			"traceId", traceID,
			"activityIndex", i,
		)
		results = append(results, result)
	}

	logger.Info("ValidateWorkerConnectionWorkflow completed",
		"traceId", traceID,
		"resultCount", len(results),
	)
	return results, nil
}
