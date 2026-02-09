package workflows

import (
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// executeCleanup runs CleanupWorkerWorkflow as a child workflow for each
// worker, then calls the CleanupJobContext activity. Matches the TypeScript
// executeCleanup function.
func executeCleanup(ctx workflow.Context, input ExecuteCleanupInput) {
	logger := workflow.GetLogger(ctx)

	// Launch cleanup for each worker in parallel and wait for all to settle.
	futures := make([]workflow.Future, len(input.WorkerIDs))
	for i, workerID := range input.WorkerIDs {
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("CleanupWorkerWorkflow-%s-%s", input.JobRunID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "CleanupWorkerWorkflow", CleanupWorkerInput{
			JobRunID: input.JobRunID,
		})
	}

	// Wait for all cleanup child workflows to complete (allSettled behavior).
	for i, f := range futures {
		var result interface{}
		if err := f.Get(ctx, &result); err != nil {
			logger.Error(fmt.Sprintf("[%s] Error in CleanupWorkerWorkflow for worker %s: %v",
				input.JobRunID, input.WorkerIDs[i], err))
		}
	}

	// Cleanup job context.
	cleanupCtx := workflow.WithActivityOptions(ctx, cleanupActivityOptions())
	var response interface{}
	err := workflow.ExecuteActivity(cleanupCtx, "CleanupJobContext", input.JobRunID).Get(ctx, &response)
	if err != nil {
		logger.Error(fmt.Sprintf("[%s] CleanupJobContextActivity failed: %v", input.JobRunID, err))
	} else {
		logger.Info(fmt.Sprintf("[%s] CleanupJobContextActivity response: %v", input.JobRunID, response))
	}
}
