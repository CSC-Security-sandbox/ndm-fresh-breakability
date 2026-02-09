package workflows

import (
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// ValidateConnectionWorkflow is the parent workflow that calls
// ValidateWorkerConnectionWorkflow for each worker ID. Registered with
// Temporal as "ValidateConnectionWorkflow" for wire compatibility.
//
// Matches the TypeScript ValidateConnectionsWorkflow (note: the Go function
// drops the trailing "s" to match the WorkFlows enum value
// "ValidateConnectionWorkflow").
func ValidateConnectionWorkflow(ctx workflow.Context, input ValidateConnectionInput) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ValidateConnectionWorkflow", "traceId", input.TraceID)

	// The input.FileServer is expected to contain a "workerIds" field and a
	// "fileServer" field matching the TypeScript payload shape.
	payload, ok := input.FileServer.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for ValidateConnectionWorkflow")
	}

	workerIDsRaw, _ := payload["workerIds"].([]interface{})
	fileServer := payload["fileServer"]
	feature, _ := payload["feature"].(string)

	// Execute a child workflow for each worker.
	futures := make([]workflow.Future, len(workerIDsRaw))
	for i, wRaw := range workerIDsRaw {
		workerID, _ := wRaw.(string)
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("ValidateConnectionWorkflow-%s-%s", input.TraceID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ValidateWorkerConnectionWorkflow", map[string]interface{}{
			"traceId":    input.TraceID,
			"fileServer": fileServer,
			"feature":    feature,
		})
	}

	// Collect results.
	var allResults []interface{}
	for _, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			return nil, err
		}
		// Flatten arrays from each worker.
		if arr, ok := result.([]interface{}); ok {
			allResults = append(allResults, arr...)
		} else {
			allResults = append(allResults, result)
		}
	}

	logger.Info("ValidateConnectionWorkflow completed", "traceId", input.TraceID)
	return allResults, nil
}

// ValidateWorkerConnectionWorkflow validates connectivity for a single worker
// by calling the ValidateConnection activity for each protocol. Registered with
// Temporal as "ValidateWorkerConnectionWorkflow".
func ValidateWorkerConnectionWorkflow(ctx workflow.Context, args map[string]interface{}) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting ValidateWorkerConnectionWorkflow", "traceId", traceID)

	fileServer, _ := args["fileServer"].(map[string]interface{})
	feature, _ := args["feature"].(string)
	protocolsRaw, _ := fileServer["protocols"].([]interface{})

	actCtx := workflow.WithActivityOptions(ctx, setupActivityOptions())

	futures := make([]workflow.Future, len(protocolsRaw))
	for i, pRaw := range protocolsRaw {
		protocol, _ := pRaw.(map[string]interface{})
		protocolType, _ := protocol["type"].(string)

		validateInput := map[string]interface{}{
			"hostname": fileServer["hostname"],
		}
		for k, v := range protocol {
			validateInput[k] = v
		}

		futures[i] = workflow.ExecuteActivity(actCtx, "ValidateConnection",
			traceID, protocolType, validateInput, feature)
	}

	var results []interface{}
	for _, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			return nil, err
		}
		results = append(results, result)
	}

	return results, nil
}
