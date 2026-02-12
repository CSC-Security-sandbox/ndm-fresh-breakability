package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ValidateWorkingDirectoryWorkflow is the parent workflow for validating export
// paths and working directories. It calls
// ValidateWorkingDirectoryWorkerWorkflow for each worker.
//
// The function name MUST match the TypeScript export name exactly
// ("ValidateWorkingDirectoryWorkflow") because the config service starts it by
// that string (WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY =
// 'ValidateWorkingDirectoryWorkflow').
func ValidateWorkingDirectoryWorkflow(ctx workflow.Context, input WorkingDirectoryInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ValidateWorkingDirectoryWorkflow", "traceId", input.TraceID)

	payload, ok := input.Payload.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for ValidateWorkingDirectoryWorkflow")
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

		// TS spreads `...options` into the child workflow start call.
		childOpts := parseChildWorkflowOptions(
			fmt.Sprintf("ValidateExportPathAndWorkingDirectoryWorkflow-%s-%s-%s", input.TraceID, workerID, fileServerSuffix),
			fmt.Sprintf("%s-TaskQueue", workerID),
			input.Options,
		)
		childCtx := workflow.WithChildOptions(ctx, childOpts)

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

	logger.Info("ValidateWorkingDirectoryWorkflow completed", "traceId", input.TraceID)
	return allResults, nil
}

// ValidateWorkingDirectoryWorkerWorkflow validates the working directory for a
// single worker. It first discovers paths (via listPath for non-storage-aware
// systems) and then validates the working directory.
//
// TS uses:
//   - proxyActivities<ListPathActivity>({ startToCloseTimeout: '30s' })
//   - proxyActivities<ValidateWorkingDirectoryActivity>({ startToCloseTimeout: '30s' })
func ValidateWorkingDirectoryWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting ValidateWorkingDirectoryWorkerWorkflow", "traceId", traceID)

	payload, _ := args["payload"].(map[string]interface{})

	// TS: proxyActivities({ startToCloseTimeout: '30s' })
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

	// Check for manual upload flag matching TS behavior.
	if listPathPayloadRaw, ok := payload["listPathPayload"].([]interface{}); ok {
		hasManualUpload := false
		for _, lpRaw := range listPathPayloadRaw {
			if lp, ok := lpRaw.(map[string]interface{}); ok {
				if eps, _ := lp["exportPathSource"].(string); eps == "MANUAL_UPLOAD" {
					hasManualUpload = true
					break
				}
			}
		}
		payload["hasManualUpload"] = hasManualUpload
	}

	// For storage-aware types, mark as such so activity knows to use exportsMap.
	if isStorageAware {
		if _, ok := payload["exportsMap"]; ok {
			payload["isStorageAware"] = true
		}
	}

	// Check export path / working directory provided.
	exportPathWorkingDirectoryProvided := false
	if ep, ok := payload["exportPath"].(string); ok && len(ep) > 0 {
		exportPathWorkingDirectoryProvided = true
		payload["exportPathPresent"] = true
	}
	payload["exportPathWorkingDirectoryProvided"] = exportPathWorkingDirectoryProvided

	if !exportPathWorkingDirectoryProvided {
		if isStorageAware {
			if exportsMap, ok := payload["exportsMap"].(map[string]interface{}); ok {
				if listPathPayloadRaw, ok := payload["listPathPayload"].([]interface{}); ok && len(listPathPayloadRaw) > 0 {
					if firstLP, ok := listPathPayloadRaw[0].(map[string]interface{}); ok {
						firstHost, _ := firstLP["host"].(string)
						if v, ok := exportsMap[firstHost]; ok {
							payload["fetchedPath"] = v
						} else if len(paths) > 0 {
							payload["fetchedPath"] = paths[0]
						}
					}
				}
			}
		} else if len(paths) > 0 {
			payload["fetchedPath"] = paths[0]
		}
	}

	// Validate the working directory.
	var result interface{}
	err := workflow.ExecuteActivity(workingDirCtx, "ValidateWorkingDirectory",
		traceID, payload).Get(ctx, &result)
	if err != nil {
		return nil, err
	}

	return result, nil
}
