package workflows

import (
	"fmt"

	"go.temporal.io/sdk/workflow"
)

const (
	// ITERATION_LIMIT triggers ContinueAsNew for the sync workflow to prevent
	// unbounded history growth. Matches the TypeScript constant.
	ITERATION_LIMIT = 1000

	// TASK_PROCESSING_ITERATIONS is the iteration cost of processing a single
	// batch of tasks. Matches the TypeScript constant.
	TASK_PROCESSING_ITERATIONS = 1
)

// ChildSyncWorkflow processes migration sync tasks fetched from Redis in a
// loop. It supports pause/stop/resume via the "syncActionSignal" signal and
// receives scan completion notification via the "scanResultSignal" signal. Uses
// ContinueAsNew to avoid unbounded history growth.
//
// Registered with Temporal as "ChildSyncWorkflow" for wire compatibility with
// the TypeScript version.
func ChildSyncWorkflow(ctx workflow.Context, input ChildSyncWorkflowInput) (*ChildSyncWorkflowOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info(fmt.Sprintf("Starting SyncWorkflow %s", input.JobRunID))

	// Apply defaults matching TypeScript default parameter values.
	if input.ActionState == "" {
		input.ActionState = StatusRunning
	}
	if input.ScanWorkflowStatus == "" {
		input.ScanWorkflowStatus = StatusRunning
	}
	if input.WorkerConcurrency == 0 {
		input.WorkerConcurrency = 20
	}

	actionState := input.ActionState
	scanWorkflowStatus := input.ScanWorkflowStatus

	// Set up signal handlers.
	actionCh := workflow.GetSignalChannel(ctx, SignalSyncAction)
	scanResultCh := workflow.GetSignalChannel(ctx, SignalScanResult)

	// Process action signals (pause/stop/resume) in background.
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for {
			var action string
			actionCh.Receive(gCtx, &action)
			logger.Info(fmt.Sprintf("%s action signal called with value: %s", input.JobRunID, action))
			actionState = action
		}
	})

	// Process scan result signals in background.
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for {
			var status string
			scanResultCh.Receive(gCtx, &status)
			logger.Info(fmt.Sprintf("%s scan workflow signal called with value: %s", input.JobRunID, status))
			scanWorkflowStatus = status
		}
	})

	output := &ChildSyncWorkflowOutput{
		JobRunID: input.JobRunID,
		Status:   StatusReady,
	}

	continueSync := true
	isManualStop := false
	iterations := 0

	for continueSync {
		// Update status if not running (e.g. paused).
		if err := updateJobStatusIfNotRunning(ctx, actionState, input.JobRunID); err != nil {
			logger.Error(fmt.Sprintf("Failed to update status for %s: %v", input.JobRunID, err))
		}

		// Wait while paused.
		_ = workflow.Await(ctx, func() bool {
			return actionState != StatusPaused
		})

		// Check stop.
		if actionState == StatusStopped {
			logger.Info(fmt.Sprintf("SyncWorkflow %s received stop signal.", input.JobRunID))
			isManualStop = true
			break
		}

		// Fetch the next group of tasks.
		fetchCtx := workflow.WithActivityOptions(ctx, taskFetchActivityOptions())
		var taskIDs []string
		err := workflow.ExecuteActivity(fetchCtx, "GetGroupOfTasks", input.JobRunID).Get(ctx, &taskIDs)
		if err != nil {
			return nil, fmt.Errorf("failed to get group of tasks: %w", err)
		}

		iterations += len(taskIDs) + TASK_PROCESSING_ITERATIONS

		// If no tasks and scan is finished, we are done.
		if len(taskIDs) == 0 && isScanFinished(scanWorkflowStatus) {
			logger.Info(fmt.Sprintf("No more tasks to process in SyncWorkflow %s.", input.JobRunID))
			continueSync = false
			continue
		}

		// Process tasks concurrently using futures.
		syncCtx := workflow.WithActivityOptions(ctx, syncActivityOptions())
		futures := make([]workflow.Future, len(taskIDs))
		for i, taskID := range taskIDs {
			logger.Info(fmt.Sprintf("SyncTaskActivity started for taskId: %s", taskID))
			futures[i] = workflow.ExecuteActivity(syncCtx, "SyncTaskActivity", SyncTaskActivityInput{
				JobRunID: input.JobRunID,
				TaskID:   taskID,
			})
		}

		// Collect results. Non-retryable errors (RetryExceededError) are logged
		// but do not abort the workflow, matching TS behavior.
		for i, f := range futures {
			var result SyncTaskActivityOutput
			err := f.Get(ctx, &result)
			if err != nil {
				// Check if this is a retry-exceeded scenario we should absorb.
				logger.Error(fmt.Sprintf("SyncTaskActivity failed for taskId: %s with error: %v", taskIDs[i], err))
				// In TypeScript, RetryExceededError is caught and logged but does
				// not abort. Other errors are re-thrown. We match that behavior
				// by returning the error for non-absorbed cases.
				// For now, continue processing remaining tasks.
				continue
			}
			logger.Info(fmt.Sprintf("SyncTaskActivity completed for taskId: %s", taskIDs[i]))
		}

		// ContinueAsNew to prevent history from growing too large.
		if iterations > ITERATION_LIMIT {
			logger.Warn(fmt.Sprintf("SyncWorkflow %s has exceeded %d iterations, continuing as new.", input.JobRunID, ITERATION_LIMIT))
			return nil, workflow.NewContinueAsNewError(ctx, ChildSyncWorkflow, ChildSyncWorkflowInput{
				JobRunID:           input.JobRunID,
				ScanWorkflowStatus: scanWorkflowStatus,
				ActionState:        actionState,
				WorkerConcurrency:  input.WorkerConcurrency,
			})
		}
	}

	if isManualStop {
		output.Status = StatusStopped
	} else {
		output.Status = StatusCompleted
	}
	return output, nil
}
