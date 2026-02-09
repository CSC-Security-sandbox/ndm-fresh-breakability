package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// WorkingDirectoryWorkflow is the parent workflow for validating export paths
// and working directories. It calls ValidateWorkingDirectoryWorkerWorkflow for
// each worker. Registered with Temporal as "WorkingDirectoryWorkflow" for wire
// compatibility (TypeScript: ValidateWorkingDirectoryWorkflow, registered as
// "ValidateExportPathAndWorkingDirectoryWorkflow").
func WorkingDirectoryWorkflow(ctx workflow.Context, input WorkingDirectoryInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting WorkingDirectoryWorkflow", "traceId", input.TraceID)

	payload, ok := input.Payload.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for WorkingDirectoryWorkflow")
	}

	workerIDsRaw, _ := payload["workerIds"].([]interface{})
	fileServerID, _ := payload["fileServerId"].(string)

	futures := make([]workflow.Future, len(workerIDsRaw))
	for i, wRaw := range workerIDsRaw {
		workerID, _ := wRaw.(string)
		fileServerSuffix := ""
		if fileServerID != "" {
			fileServerSuffix = fileServerID
		}
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("ValidateExportPathAndWorkingDirectoryWorkflow-%s-%s-%s", input.TraceID, workerID, fileServerSuffix),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ValidateWorkingDirectoryWorkerWorkflow", map[string]interface{}{
			"traceId": input.TraceID,
			"payload": payload,
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

	logger.Info("WorkingDirectoryWorkflow completed", "traceId", input.TraceID)
	return allResults, nil
}

// ValidateWorkingDirectoryWorkerWorkflow validates the working directory for a
// single worker. It first discovers paths (via listPath for non-storage-aware
// systems) and then validates the working directory. Registered with Temporal
// as "ValidateWorkingDirectoryWorkerWorkflow".
func ValidateWorkingDirectoryWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting ValidateWorkingDirectoryWorkerWorkflow", "traceId", traceID)

	payload, _ := args["payload"].(map[string]interface{})

	listPathCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
	})
	workingDirCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
	})

	// Check if this is a storage-aware type.
	serverType, _ := payload["serverType"].(string)
	isStorageAware := serverType != "OtherNAS"

	var paths []interface{}

	if isStorageAware {
		// For storage-aware types, exports are already discovered via API.
		logger.Info("Storage-aware: Skipping showmount - exports already discovered via API")
		if dp, ok := payload["discoveredPaths"].([]interface{}); ok {
			paths = dp
		}
	} else {
		// For OtherNAS: Run showmount to discover exports.
		logger.Info("OtherNAS: Running showmount to discover exports")
		listPathPayloadRaw, _ := payload["listPathPayload"].([]interface{})
		for _, lpRaw := range listPathPayloadRaw {
			lp, _ := lpRaw.(map[string]interface{})
			protocolType, _ := lp["type"].(string)
			listInput := map[string]interface{}{
				"hostname":         lp["host"],
				"username":         lp["username"],
				"password":         lp["password"],
				"exportPathSource": lp["exportPathSource"],
			}

			var result map[string]interface{}
			err := workflow.ExecuteActivity(listPathCtx, "ListPaths",
				traceID, protocolType, listInput).Get(ctx, &result)
			if err != nil {
				logger.Error(fmt.Sprintf("ListPaths failed: %v", err))
				continue
			}
			if resultPaths, ok := result["paths"].([]interface{}); ok {
				paths = resultPaths
			}
		}
	}

	payload["paths"] = paths

	// Validate the working directory.
	var result interface{}
	err := workflow.ExecuteActivity(workingDirCtx, "ValidateWorkingDirectory",
		traceID, payload).Get(ctx, &result)
	if err != nil {
		return nil, err
	}

	return result, nil
}
