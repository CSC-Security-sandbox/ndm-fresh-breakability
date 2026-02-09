package workflows

import (
	"errors"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// executeMigrationChildWorkflows starts ChildScanWorkflow and
// ChildSyncWorkflow as child workflows in parallel. When the scan finishes, it
// sends a scanResultSignal to the sync workflow. It handles the "action" signal
// from the parent to forward pause/stop/resume or cancel both children.
//
// Matches the TypeScript executeMigrationChildWorkflows function.
func executeMigrationChildWorkflows(ctx workflow.Context, jobRunID string) (*MigrationChildWorkflowsOutput, error) {
	_ = workflow.GetLogger(ctx)

	output := &MigrationChildWorkflowsOutput{
		Status:        StatusRunning,
		ScanJobStatus: StatusRunning,
		SyncJobStatus: StatusRunning,
	}

	scanWorkflowID := fmt.Sprintf("ScanWorkflow-%s", jobRunID)
	syncWorkflowID := fmt.Sprintf("SyncWorkflow-%s", jobRunID)

	// Set up the parent-level action signal handler.
	actionCh := workflow.GetSignalChannel(ctx, SignalAction)
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for {
			var action string
			actionCh.Receive(gCtx, &action)

			if action == StatusStopped {
				cancelWorkflowIfRunning(gCtx, scanWorkflowID)
				cancelWorkflowIfRunning(gCtx, syncWorkflowID)
				output.Status = StatusStopped
				output.ScanJobStatus = StatusStopped
				output.SyncJobStatus = StatusStopped
				return
			}
			signalIfRunning(gCtx, scanWorkflowID, SignalScanAction, action)
			signalIfRunning(gCtx, syncWorkflowID, SignalSyncAction, action)
		}
	})

	if output.Status != StatusStopped {
		// Start scan child workflow.
		scanChildCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        scanWorkflowID,
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", jobRunID),
			ParentClosePolicy: 1, // TERMINATE
		})
		scanFuture := workflow.ExecuteChildWorkflow(scanChildCtx, "ChildScanWorkflow", ChildScanWorkflowInput{
			JobRunID:    jobRunID,
			IsMigration: true,
		})

		// Start sync child workflow.
		syncChildCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        syncWorkflowID,
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", jobRunID),
			ParentClosePolicy: 1, // TERMINATE
		})
		syncFuture := workflow.ExecuteChildWorkflow(syncChildCtx, "ChildSyncWorkflow", ChildSyncWorkflowInput{
			JobRunID:           jobRunID,
			ScanWorkflowStatus: StatusRunning,
		})

		// Wait for scan to complete first.
		var scanResult ChildScanWorkflowOutput
		err := scanFuture.Get(ctx, &scanResult)
		if err != nil {
			var canceledErr *temporal.CanceledError
			if errors.As(err, &canceledErr) {
				output.ScanJobStatus = StatusStopped
			} else {
				output.ScanJobStatus = StatusFailed
			}
			// If scan failed, cancel sync.
			cancelWorkflowIfRunning(ctx, syncWorkflowID)
		} else {
			output.FileCount = scanResult.FileCount
			output.DirCount = scanResult.DirCount
			output.ScanJobStatus = scanResult.Status
		}

		// Signal the sync workflow with the scan completion status.
		signalIfRunning(ctx, syncWorkflowID, SignalScanResult, output.ScanJobStatus)

		// Wait for sync to complete.
		var syncResult ChildSyncWorkflowOutput
		err = syncFuture.Get(ctx, &syncResult)
		if err != nil {
			var syncCanceledErr *temporal.CanceledError
			if errors.As(err, &syncCanceledErr) {
				output.SyncJobStatus = StatusStopped
			} else {
				output.SyncJobStatus = StatusFailed
			}
			// Report sync failure.
			respCtx := workflow.WithActivityOptions(ctx, shortActivityOptions())
			_ = workflow.ExecuteActivity(respCtx, "UpdateWorkerResponse",
				jobRunID, "all", WorkerResponseInput{
					Status:     output.SyncJobStatus,
					Code:       "TASK_FETCH_FAILURE",
					Operation:  "Sync Workflow Failed",
					Occurrence: 1,
					Origin:     "ChildSyncWorkflow",
					Message:    fmt.Sprintf("Sync workflow failed with error: %v", err),
					CreatedAt:  workflow.Now(ctx),
				}).Get(ctx, nil)
			// Cancel scan if sync failed.
			cancelWorkflowIfRunning(ctx, scanWorkflowID)
		} else {
			output.SyncJobStatus = syncResult.Status
		}
	}

	output.Status = getUnifiedJobStatus(output.ScanJobStatus, output.SyncJobStatus)

	// Update last entry.
	lastEntryCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Minute,
		RetryPolicy:         shortActivityOptions().RetryPolicy,
	})
	_ = workflow.ExecuteActivity(lastEntryCtx, "UpdateLastEntry", jobRunID).Get(ctx, nil)

	return output, nil
}
