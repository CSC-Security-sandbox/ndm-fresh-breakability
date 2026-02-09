package workflows

import (
	"fmt"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// executeWorkerSetup starts a SetupWorkerWorkflow as a child workflow for each
// worker ID. It waits until at least one worker succeeds or all fail. If all
// workers fail, it updates the job error status and returns a non-retryable
// error. Matches the TypeScript executeWorkerSetup function.
func executeWorkerSetup(ctx workflow.Context, input ExecuteWorkerSetupInput) (*ExecuteWorkerSetupOutput, error) {
	logger := workflow.GetLogger(ctx)

	setupCompletedWorkers := make([]string, 0)
	failedWorkers := make([]string, 0)

	// Launch a child workflow for each worker.
	type workerResult struct {
		workerID string
		output   SetupWorkerOutput
		err      error
	}

	resultCh := workflow.NewChannel(ctx)

	for _, workerID := range input.WorkerIDs {
		wID := workerID
		workflow.Go(ctx, func(gCtx workflow.Context) {
			childCtx := workflow.WithChildOptions(gCtx, workflow.ChildWorkflowOptions{
				WorkflowID:        fmt.Sprintf("SetupWorkerWorkflow-%s-%s", input.JobRunID, wID),
				TaskQueue:         fmt.Sprintf("%s-TaskQueue", wID),
				ParentClosePolicy: 1, // TERMINATE
			})

			var result SetupWorkerOutput
			err := workflow.ExecuteChildWorkflow(childCtx, "SetupWorkerWorkflow", SetupWorkerInput{
				JobRunID: input.JobRunID,
			}).Get(gCtx, &result)

			resultCh.Send(gCtx, workerResult{workerID: wID, output: result, err: err})
		})
	}

	// Collect results.
	for i := 0; i < len(input.WorkerIDs); i++ {
		var wr workerResult
		resultCh.Receive(ctx, &wr)

		if wr.err != nil {
			logger.Error(fmt.Sprintf("Error in SetupWorkerWorkflow for worker %s: %v", wr.workerID, wr.err))
			failedWorkers = append(failedWorkers, wr.workerID)

			detailedMsg := fmt.Sprintf("%v", wr.err)
			updateWorkerFailedResponse(ctx, wr.workerID, input.JobRunID, detailedMsg)
		} else if wr.output.Status == "success" {
			setupCompletedWorkers = append(setupCompletedWorkers, wr.workerID)
		} else {
			failedWorkers = append(failedWorkers, wr.workerID)
			msg := wr.output.Message
			if msg == "" {
				msg = "Unknown error"
			}
			updateWorkerFailedResponse(ctx, wr.workerID, input.JobRunID, msg)
		}
	}

	// If all workers failed, update job error status and return an error.
	if len(failedWorkers) == len(input.WorkerIDs) {
		errCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: shortActivityOptions().StartToCloseTimeout,
			RetryPolicy:         shortActivityOptions().RetryPolicy,
		})
		_ = workflow.ExecuteActivity(errCtx, "UpdateJobErrorStatus", input.JobRunID).Get(ctx, nil)
		return nil, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("All workers failed to setup: %v", failedWorkers),
			"AllWorkersFailedSetup",
			nil,
		)
	}

	return &ExecuteWorkerSetupOutput{
		SetupCompletedWorkers: setupCompletedWorkers,
		FailedWorkers:         failedWorkers,
	}, nil
}

// updateWorkerFailedResponse reports a worker setup failure via the
// UpdateWorkerResponse activity.
func updateWorkerFailedResponse(ctx workflow.Context, workerID, jobRunID, message string) {
	respCtx := workflow.WithActivityOptions(ctx, shortActivityOptions())
	_ = workflow.ExecuteActivity(respCtx, "UpdateWorkerResponse",
		jobRunID, workerID, WorkerResponseInput{
			Status:     "FAILED",
			Code:       "SETUP_WORKER_FAILURE",
			Operation:  "Worker Setup Failed",
			Occurrence: 1,
			Origin:     "Worker",
			Message:    message,
			CreatedAt:  workflow.Now(ctx),
		}).Get(ctx, nil)
}
