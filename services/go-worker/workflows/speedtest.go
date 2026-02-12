package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// SpeedTestWorkflow is the parent workflow for speed test jobs. It sets up
// workers, runs the speed test job workflow, and cleans up.
//
// The TS version orchestrates:
//
//	SetupWorkerWorkflow (per fileServer/worker) →
//	SpeedTestJobWorkflow (per active worker) →
//	CleanupWorkerWorkflow (per active worker)
//
// All child workflows are dispatched to per-worker task queues.
func SpeedTestWorkflow(ctx workflow.Context, input SpeedTestInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting SpeedTestWorkflow", "traceId", input.TraceID)

	// payload is an array of fileServer objects (each with workerEntities).
	payloadArr, ok := input.Payload.([]interface{})
	if !ok {
		return map[string]interface{}{
			"traceId": input.TraceID,
			"status":  "error",
			"message": "invalid payload type",
		}, nil
	}

	// Phase 1: Setup workers via SetupWorkerWorkflow children.
	type activeWorker struct {
		WorkerID     string
		FSDetails    interface{}
		FileServerID string
		VolumeID     string
		ProtocolType string
		Tests        interface{}
	}

	var activeWorkerIds []activeWorker
	var setupResults []interface{}

	for _, fsRaw := range payloadArr {
		fs, _ := fsRaw.(map[string]interface{})
		workerEntities, _ := fs["workerEntities"].([]interface{})
		fileServerDetails, _ := fs["fileServerDetails"].(map[string]interface{})
		protocol, _ := fs["protocol"].(string)

		for _, wRaw := range workerEntities {
			wEntity, _ := wRaw.(map[string]interface{})
			workerID, _ := wEntity["workersId"].(string)

			childOpts := parseChildWorkflowOptions(
				fmt.Sprintf("SetupWorkerWorkflows-%s-%s-%s",
					input.TraceID, fmt.Sprintf("%v", fs["fileServer"]), workerID),
				fmt.Sprintf("%s-TaskQueue", workerID),
				input.Options,
			)
			childCtx := workflow.WithChildOptions(ctx, childOpts)

			setupArgs := map[string]interface{}{
				"jobRunId":     input.TraceID,
				"fileServer":   fs,
				"hostname":     fileServerDetails["host"],
				"protocols":    []interface{}{},
				"pathId":       fileServerDetails["volumes"].(map[string]interface{})["id"],
				"path":         fileServerDetails["volumes"].(map[string]interface{})["volumePath"],
				"username":     fileServerDetails["userName"],
				"password":     fileServerDetails["password"],
				"protocolType": protocol,
				"volumeId":     fileServerDetails["volumes"].(map[string]interface{})["id"],
				"tests": map[string]interface{}{
					"readTest":           fs["readTest"],
					"writeTest":          fs["writeTest"],
					"networkPerformance": fs["packetLossTest"],
				},
			}

			var result SetupWorkerOutput
			err := workflow.ExecuteChildWorkflow(childCtx, "SetupWorkerWorkflow", setupArgs).Get(ctx, &result)
			if err != nil {
				logger.Error(fmt.Sprintf("Error in SetupWorkerWorkflow: %v", err))
				continue
			}

			setupResults = append(setupResults, result)
			if result.Status == "success" {
				activeWorkerIds = append(activeWorkerIds, activeWorker{
					WorkerID:     result.WorkerID,
					FSDetails:    result.FSDetails,
					FileServerID: result.FileServerID,
					VolumeID:     result.VolumeID,
					ProtocolType: result.ProtocolType,
					Tests:        setupArgs["tests"],
				})
			}
		}
	}

	if len(activeWorkerIds) == 0 {
		logger.Info("No active workers found")
		return map[string]interface{}{
			"traceId": input.TraceID,
			"status":  "error",
			"message": fmt.Sprintf("No active workers found for %s", input.TraceID),
		}, nil
	}

	// Phase 2: Run SpeedTestJobWorkflow for each active worker.
	var speedTestResponse interface{}
	speedTestFutures := make([]workflow.Future, len(activeWorkerIds))
	for i, aw := range activeWorkerIds {
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("SpeedTestJobWorkflow-%s", input.TraceID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", aw.WorkerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		speedTestFutures[i] = workflow.ExecuteChildWorkflow(childCtx, "SpeedTestJobWorkflow", map[string]interface{}{
			"traceId":      input.TraceID,
			"workerId":     aw.WorkerID,
			"fsDetails":    aw.FSDetails,
			"fileServerId": aw.FileServerID,
			"volumeId":     aw.VolumeID,
			"tests":        aw.Tests,
		})
	}

	allSucceeded := true
	for _, f := range speedTestFutures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			logger.Error(fmt.Sprintf("SpeedTestJobWorkflow error: %v", err))
			allSucceeded = false
		}
	}

	if allSucceeded {
		speedTestResponse = map[string]interface{}{
			"traceId": input.TraceID,
			"status":  "success",
			"message": fmt.Sprintf("SpeedTest Successfully completed for %s", input.TraceID),
		}
	} else {
		speedTestResponse = map[string]interface{}{
			"traceId": input.TraceID,
			"status":  "error",
			"message": fmt.Sprintf("Failed to do Speed Test for %s", input.TraceID),
		}
	}

	// Phase 3: Cleanup workers via CleanupWorkerWorkflow children.
	for _, aw := range activeWorkerIds {
		childOpts := parseChildWorkflowOptions(
			fmt.Sprintf("CleanupWorkerWorkflow-%s", input.TraceID),
			fmt.Sprintf("%s-TaskQueue", aw.WorkerID),
			input.Options,
		)
		childCtx := workflow.WithChildOptions(ctx, childOpts)

		var cleanupResult interface{}
		err := workflow.ExecuteChildWorkflow(childCtx, "CleanupWorkerWorkflow", map[string]interface{}{
			"jobRunId":     input.TraceID,
			"jobType":      "SPEED_TEST",
			"fsDetails":    aw.FSDetails,
			"protocolType": aw.ProtocolType,
		}).Get(ctx, &cleanupResult)
		if err != nil {
			logger.Error(fmt.Sprintf("Error in CleanupWorkerWorkflow: %v", err))
		}
	}

	return speedTestResponse, nil
}

// SpeedTestJobWorkflow executes the speed test for a single worker.
// Registered with Temporal as "SpeedTestJobWorkflow".
//
// TS uses:
//   - proxyActivities<SpeedTestActivities>({ startToCloseTimeout: '300s', retry: { maximumAttempts: 3 } })
//   - proxyActivities<CommonActivityService>({ startToCloseTimeout: '24h' })
func SpeedTestJobWorkflow(ctx workflow.Context, args map[string]interface{}) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	traceID, _ := args["traceId"].(string)
	logger.Info("Starting SpeedTestJobWorkflow", "traceId", traceID)

	// TS: proxyActivities({ startToCloseTimeout: '24h' })
	statusCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions())

	// TS: proxyActivities({ startToCloseTimeout: '300s', retry: { maximumAttempts: 3 } })
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 300 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	})

	// Update status to Running.
	_ = workflow.ExecuteActivity(statusCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: traceID,
		Status:   StatusRunning,
	}).Get(ctx, nil)

	workerID, _ := args["workerId"].(string)
	fileServerID, _ := args["fileServerId"].(string)

	// Post initial results.
	var data map[string]interface{}
	if err := workflow.ExecuteActivity(actCtx, "PostResultsActivity",
		traceID, workerID, fileServerID, nil).Get(ctx, &data); err != nil {
		return nil, err
	}

	tests, _ := args["tests"].(map[string]interface{})
	volumeID, _ := args["volumeId"].(string)

	var writeResult, readResult, networkResult interface{}
	var testErr error

	if doWrite, _ := tests["writeTest"].(bool); doWrite {
		writeResultID, _ := data["writeResultId"].(string)
		if err := workflow.ExecuteActivity(actCtx, "WriteActivity",
			args, traceID, volumeID, writeResultID).Get(ctx, &writeResult); err != nil {
			testErr = err
			logger.Error(fmt.Sprintf("Write activity failed: %v", err))
		}
	}

	if doRead, _ := tests["readTest"].(bool); doRead {
		readResultID, _ := data["readResultId"].(string)
		if err := workflow.ExecuteActivity(actCtx, "ReadActivity",
			args, traceID, volumeID, readResultID).Get(ctx, &readResult); err != nil {
			testErr = err
			logger.Error(fmt.Sprintf("Read activity failed: %v", err))
		}
	}

	if doNetwork, _ := tests["networkPerformance"].(bool); doNetwork {
		if err := workflow.ExecuteActivity(actCtx, "NetworkPerformanceActivity",
			args, traceID).Get(ctx, &networkResult); err != nil {
			testErr = err
			logger.Error(fmt.Sprintf("Network performance activity failed: %v", err))
		}
	}

	results := map[string]interface{}{
		"writeResult":              writeResult,
		"readResult":               readResult,
		"networkPerformanceResult": networkResult,
	}
	_ = workflow.ExecuteActivity(actCtx, "PostResultsActivity",
		traceID, workerID, fileServerID, results).Get(ctx, nil)

	finalStatus := StatusCompleted
	if testErr != nil {
		finalStatus = StatusFailed
	}

	_ = workflow.ExecuteActivity(statusCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: traceID,
		Status:   finalStatus,
	}).Get(ctx, nil)

	logger.Info("Speed test completed", "traceId", traceID, "status", finalStatus)
	return nil, nil
}
