package workflows

import (
	"errors"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// executeDiscoveryChildWorkflows starts a ChildScanWorkflow as a child
// workflow for discovery (non-migration) scanning. It handles the "action"
// signal from the parent to forward pause/stop/resume to the scan child.
//
// Matches the TypeScript executeDiscoveryChildWorkflows function.
func executeDiscoveryChildWorkflows(ctx workflow.Context, jobRunID string) (*DiscoveryChildWorkflowsOutput, error) {
	logger := workflow.GetLogger(ctx)

	output := &DiscoveryChildWorkflowsOutput{
		Status: StatusRunning,
	}

	var scanWorkflowID string
	isScanRunning := false

	// Set up the parent-level action signal handler. This forwards signals
	// to the child scan workflow.
	actionCh := workflow.GetSignalChannel(ctx, SignalAction)
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for {
			var action string
			actionCh.Receive(gCtx, &action)

			if action == StatusStopped {
				cancelWorkflowIfRunning(gCtx, scanWorkflowID)
				output.Status = StatusStopped
				return
			}
			if isScanRunning && scanWorkflowID != "" {
				if err := signalExternalWorkflow(gCtx, scanWorkflowID, SignalScanAction, action); err != nil {
					logger.Error(fmt.Sprintf("Failed to signal scan workflow: %v", err))
				}
			}
		}
	})

	if output.Status != StatusStopped {
		scanWorkflowID = fmt.Sprintf("ScanWorkflow-%s", jobRunID)
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        scanWorkflowID,
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", jobRunID),
			ParentClosePolicy: 1, // TERMINATE
		})

		scanFuture := workflow.ExecuteChildWorkflow(childCtx, "ChildScanWorkflow", ChildScanWorkflowInput{
			JobRunID:    jobRunID,
			IsMigration: false,
		})
		isScanRunning = true

		var scanResult ChildScanWorkflowOutput
		err := scanFuture.Get(ctx, &scanResult)
		if err != nil {
			// Check if it was a cancellation.
			var canceledErr *temporal.CanceledError
			if errors.As(err, &canceledErr) {
				output.Status = StatusStopped
			} else {
				logger.Error(fmt.Sprintf("[%s] Error in ChildScanWorkflow: %v", jobRunID, err))
				output.Status = StatusFailed

				// Report the failure.
				respCtx := workflow.WithActivityOptions(ctx, shortActivityOptions())
				_ = workflow.ExecuteActivity(respCtx, "UpdateWorkerResponse",
					jobRunID, "all", WorkerResponseInput{
						Status:     output.Status,
						Code:       "SCAN_ACTIVITY_FAILURE",
						Operation:  "Scan Workflow Failed",
						Occurrence: 1,
						Origin:     "ChildScanWorkflow",
						Message:    fmt.Sprintf("Scan workflow failed with error: %v", err),
						CreatedAt:  workflow.Now(ctx),
					}).Get(ctx, nil)
			}
		} else {
			output.Status = scanResult.Status
			output.FileCount = scanResult.FileCount
			output.DirCount = scanResult.DirCount
		}
	}
	isScanRunning = false

	// Update last entry.
	lastEntryCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy:         shortActivityOptions().RetryPolicy,
	})
	_ = workflow.ExecuteActivity(lastEntryCtx, "UpdateLastEntry", jobRunID).Get(ctx, nil)

	return output, nil
}
