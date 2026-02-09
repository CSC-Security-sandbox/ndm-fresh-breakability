package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ValidatePathWorkflow is the parent workflow that calls
// ValidatePathWorkerWorkflow for each worker ID and then posts the validation
// results. Registered with Temporal as "ValidatePathWorkflow" for wire
// compatibility (TypeScript: ValidatePathsWorkflow).
func ValidatePathWorkflow(ctx workflow.Context, input ValidatePathInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ValidatePathWorkflow", "traceId", input.TraceID)

	payload, ok := input.FileServer.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for ValidatePathWorkflow")
	}

	workerIDsRaw, _ := payload["workerIds"].([]interface{})
	paths := payload["paths"]
	fileServer := payload["fileServer"]

	futures := make([]workflow.Future, len(workerIDsRaw))
	for i, wRaw := range workerIDsRaw {
		workerID, _ := wRaw.(string)
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("ValidatePathsWorkflow-%s-%s", input.TraceID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "ValidatePathWorkerWorkflow", map[string]interface{}{
			"traceId":    input.TraceID,
			"paths":      paths,
			"fileServer": fileServer,
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

	// Post the validation results.
	postCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
	})
	_ = workflow.ExecuteActivity(postCtx, "PostValidationResult", input.TraceID, allResults).Get(ctx, nil)

	logger.Info("ValidatePathWorkflow completed", "traceId", input.TraceID)
	return allResults, nil
}

// ValidatePathWorkerWorkflow validates paths for a single worker. Registered
// with Temporal as "ValidatePathWorkerWorkflow".
func ValidatePathWorkerWorkflow(ctx workflow.Context, args map[string]interface{}) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting ValidatePathWorkerWorkflow", "traceId", traceID)

	fileServer, _ := args["fileServer"].(map[string]interface{})
	pathsRaw, _ := args["paths"].([]interface{})

	actCtx := workflow.WithActivityOptions(ctx, setupActivityOptions())

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
