package workflows

import (
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// ListPathWorkflow is the parent workflow that calls ListPathWorkerWorkflow
// for each worker ID. Registered with Temporal as "ListPathWorkflow" for wire
// compatibility (matches the TypeScript ListPathsWorkflow export name, but
// registered via the WorkFlows enum as "ListPathsWorkflow").
func ListPathWorkflow(ctx workflow.Context, input ListPathInput) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ListPathWorkflow", "traceId", input.TraceID)

	payload, ok := input.FileServer.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for ListPathWorkflow")
	}

	workerIDsRaw, _ := payload["workerIds"].([]interface{})
	fileServer := payload["fileServer"]

	futures := make([]workflow.Future, len(workerIDsRaw))
	for i, wRaw := range workerIDsRaw {
		workerID, _ := wRaw.(string)
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("ListPathsWorkflow-%s-%s", input.TraceID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ListPathWorkerWorkflow", map[string]interface{}{
			"traceId":    input.TraceID,
			"fileServer": fileServer,
		})
	}

	var allResults []interface{}
	for _, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			return nil, err
		}
		if arr, ok := result.([]interface{}); ok {
			allResults = append(allResults, arr...)
		} else {
			allResults = append(allResults, result)
		}
	}

	logger.Info("ListPathWorkflow completed", "traceId", input.TraceID)
	return allResults, nil
}

// ListPathWorkerWorkflow lists available paths from a file server for a single
// worker. Registered with Temporal as "ListPathWorkerWorkflow".
func ListPathWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) ([]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting ListPathWorkerWorkflow", "traceId", traceID)

	fileServer, _ := args["fileServer"].(map[string]interface{})
	protocolsRaw, _ := fileServer["protocols"].([]interface{})

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * 1000000000, // 30 seconds
	})

	futures := make([]workflow.Future, len(protocolsRaw))
	for i, pRaw := range protocolsRaw {
		protocol, _ := pRaw.(map[string]interface{})
		protocolType, _ := protocol["type"].(string)

		listInput := map[string]interface{}{
			"hostname": fileServer["hostname"],
		}
		for k, v := range protocol {
			listInput[k] = v
		}

		futures[i] = workflow.ExecuteActivity(actCtx, "ListPaths",
			traceID, protocolType, listInput)
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
