package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ValidatePathsWorkflow is the parent workflow that calls
// ValidatePathWorkerWorkflow for each worker ID and then posts the validation
// results.
//
// The function name MUST match the TypeScript export name exactly
// ("ValidatePathsWorkflow" with the trailing "s") because the Temporal Go SDK
// registers it under the function name, and the config service starts it by
// that string (WorkFlows.VALIDATE_PATHS = 'ValidatePathsWorkflow').
func ValidatePathsWorkflow(ctx workflow.Context, input ValidatePathsInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ValidatePathsWorkflow",
		"traceId", input.TraceID,
		"workerCount", len(input.Payload.WorkerIDs),
	)

	data := input.Payload

	if len(data.WorkerIDs) == 0 {
		logger.Warn("ValidatePathsWorkflow: no worker IDs in payload", "traceId", input.TraceID)
		return []interface{}{}, nil
	}

	// Execute a child workflow for each worker.
	// The TS workflow spreads `...options` into the child workflow start call.
	futures := make([]workflow.Future, len(data.WorkerIDs))
	for i, workerID := range data.WorkerIDs {
		childOpts := parseChildWorkflowOptions(
			fmt.Sprintf("ValidatePathsWorkflow-%s-%s", input.TraceID, workerID),
			fmt.Sprintf("%s-TaskQueue", workerID),
			input.Options,
		)
		childCtx := workflow.WithChildOptions(ctx, childOpts)

		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ValidatePathWorkerWorkflow", map[string]interface{}{
			"traceId":    input.TraceID,
			"paths":      data.Paths,
			"fileServer": data.FileServer,
			"workerId":   workerID,
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

	// Post the validation results. TS: proxyActivities({ startToCloseTimeout: '5m' })
	postCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
	})
	_ = workflow.ExecuteActivity(postCtx, "PostValidationResult", input.TraceID, allResults).Get(ctx, nil)

	logger.Info("ValidatePathsWorkflow completed", "traceId", input.TraceID)
	return allResults, nil
}

// ValidatePathWorkerWorkflow validates paths for a single worker.
// Registered with Temporal as "ValidatePathWorkerWorkflow".
//
// TS uses: proxyActivities({ startToCloseTimeout: '300s' })
func ValidatePathWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting ValidatePathWorkerWorkflow", "traceId", traceID)

	fileServer, _ := args["fileServer"].(map[string]interface{})
	pathsRaw, _ := args["paths"].([]interface{})

	// TS: proxyActivities({ startToCloseTimeout: '300s' })
	actCtx := workflow.WithActivityOptions(ctx, validatePathActivityOptions())

	var validationResults []interface{}
	for _, pRaw := range pathsRaw {
		path, _ := pRaw.(map[string]interface{})
		pathID, _ := path["pathId"].(string)
		exportPath, _ := path["path"].(string)

		validateInput := ValidatePathActivityInput{
			Path:            exportPath,
			Host:            fmt.Sprintf("%v", fileServer["host"]),
			Username:        fmt.Sprintf("%v", fileServer["username"]),
			Password:        fmt.Sprintf("%v", fileServer["password"]),
			Protocol:        fmt.Sprintf("%v", fileServer["type"]),
			UploadID:        traceID,
			ProtocolVersion: fmt.Sprintf("%v", fileServer["protocolVersion"]),
			PathID:          pathID,
		}

		var result interface{}
		err := workflow.ExecuteActivity(actCtx, "ValidatePath", validateInput).Get(ctx, &result)
		if err != nil {
			validationResults = append(validationResults, map[string]interface{}{
				"traceId":  traceID,
				"status":   "error",
				"path":     exportPath,
				"pathId":   pathID,
				"message":  fmt.Sprintf("Error validating path: %v", err),
			})
		} else {
			validationResults = append(validationResults, map[string]interface{}{
				"result": result,
			})
		}
	}

	return map[string]interface{}{
		"validationResult": validationResults,
		"traceId":          traceID,
	}, nil
}
