package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Signal name constants. These MUST match the TypeScript signal names exactly
// for wire compatibility.
const (
	SignalScanAction  = "scanActionSignal"
	SignalSyncAction  = "syncActionSignal"
	SignalScanResult  = "scanResultSignal"
	SignalAction      = "action"
	SignalReporting   = "reportingSignal"
	SignalApprove     = "approve"
)

// Query name constants.
const (
	QueryIsReported = "isReported"
	QueryIsBlocked  = "isBlocked"
)

// defaultActivityOptions returns standard activity options for long-running
// activities (e.g. status updates, report generation).
func defaultActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 24 * time.Hour,
		HeartbeatTimeout:    2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 30 * time.Second,
			BackoffCoefficient: 1,
		},
	}
}

// shortActivityOptions returns activity options for shorter activities
// (e.g. utility checks).
func shortActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 30 * time.Second,
			BackoffCoefficient: 1,
		},
	}
}

// scanActivityOptions returns activity options for scan activities.
func scanActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 96 * time.Hour,
		HeartbeatTimeout:    2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:      3,
			InitialInterval:     10 * time.Second,
			BackoffCoefficient:  2.0,
			NonRetryableErrorTypes: []string{"ActivityFailure", "FatalError"},
		},
	}
}

// syncActivityOptions returns activity options for sync (migration) activities.
func syncActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Hour,
		HeartbeatTimeout:    1 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:      10,
			InitialInterval:     10 * time.Second,
			BackoffCoefficient:  1,
			MaximumInterval:     30 * time.Second,
			NonRetryableErrorTypes: []string{"FatalError", "RetryExceededError", "ApplicationFailure"},
		},
	}
}

// taskFetchActivityOptions returns activity options for getGroupOfTasks.
func taskFetchActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:      3,
			InitialInterval:     10 * time.Second,
			BackoffCoefficient:  2.0,
			MaximumInterval:     30 * time.Second,
			NonRetryableErrorTypes: []string{"ActivityFailure", "FatalError"},
		},
	}
}

// cmdStreamCheckOptions returns activity options for isCmdStreamLenValid.
func cmdStreamCheckOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:      3,
			InitialInterval:     2 * time.Second,
			BackoffCoefficient:  2.0,
			MaximumInterval:     30 * time.Second,
			NonRetryableErrorTypes: []string{"ApplicationFailure"},
		},
	}
}

// setupActivityOptions returns options for setup/cleanup activities.
func setupActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
	}
}

// cleanupActivityOptions returns options for cleanup-related activities.
func cleanupActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    3,
			InitialInterval:   30 * time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:   2 * time.Minute,
		},
	}
}

// updateJobStatusIfNotRunning calls the UpdateStatus activity when the current
// actionState is not Running. This mirrors the TypeScript
// updateJobStatusIfNotRunning helper.
func updateJobStatusIfNotRunning(ctx workflow.Context, actionState, jobRunID string) error {
	if actionState != StatusRunning {
		actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions())
		return workflow.ExecuteActivity(actCtx, "UpdateStatus", UpdateStatusInput{
			JobRunID: jobRunID,
			Status:   actionState,
		}).Get(ctx, nil)
	}
	return nil
}

// getUnifiedJobStatus combines scan and sync statuses into a single job status.
// Matches the TypeScript getUnifiedJobStatus function.
func getUnifiedJobStatus(scanStatus, syncStatus string) string {
	if scanStatus == StatusFailed || syncStatus == StatusFailed {
		return StatusFailed
	}
	if scanStatus == StatusStopped || syncStatus == StatusStopped {
		return StatusStopped
	}
	return StatusCompleted
}

// getMappedJobRunStatus maps the workflow completion status with the report
// type to produce the appropriate job run status for reporting. Matches the
// TypeScript getMappedJobRunStatus function.
func getMappedJobRunStatus(status, reportType string) string {
	if status == StatusCompleted && reportType == JobReportTypeCutOver {
		return StatusBlocked
	}
	return status
}

// logWorkflow is a convenience wrapper for workflow.GetLogger.
func logWorkflow(ctx workflow.Context, msg string, keyvals ...interface{}) {
	workflow.GetLogger(ctx).Info(msg, keyvals...)
}

// logWorkflowError logs an error-level message within a workflow context.
func logWorkflowError(ctx workflow.Context, msg string, keyvals ...interface{}) {
	workflow.GetLogger(ctx).Error(msg, keyvals...)
}

// childWorkflowOptions returns default child workflow options.
func childWorkflowOptions(workflowID, taskQueue string) workflow.ChildWorkflowOptions {
	return workflow.ChildWorkflowOptions{
		WorkflowID:            workflowID,
		TaskQueue:             taskQueue,
		ParentClosePolicy:     1, // TERMINATE
		WorkflowRunTimeout:    0, // no timeout
	}
}

// isScanFinished returns true when the scan status indicates no more work.
func isScanFinished(status string) bool {
	return status == StatusCompleted || status == StatusFailed
}

// isWorkflowRunningActivity calls the isWorkflowRunningActivity to check
// whether a given workflow is still running.
func checkWorkflowRunning(ctx workflow.Context, workflowID string) (bool, error) {
	actCtx := workflow.WithActivityOptions(ctx, shortActivityOptions())
	var isRunning bool
	err := workflow.ExecuteActivity(actCtx, "IsWorkflowRunning", workflowID).Get(ctx, &isRunning)
	return isRunning, err
}

// cancelWorkflowIfRunning attempts to cancel a child workflow if it is still
// running. Mirrors the TypeScript cancelWorkflowIfRunning utility.
func cancelWorkflowIfRunning(ctx workflow.Context, workflowID string) {
	isRunning, err := checkWorkflowRunning(ctx, workflowID)
	if err != nil {
		logWorkflow(ctx, fmt.Sprintf("Failed to check if workflow %s is running", workflowID))
		return
	}
	if !isRunning {
		logWorkflow(ctx, fmt.Sprintf("%s is not running", workflowID))
		return
	}
	// Request cancellation via Temporal external workflow handle.
	err = workflow.RequestCancelExternalWorkflow(ctx, workflowID, "").Get(ctx, nil)
	if err != nil {
		logWorkflow(ctx, fmt.Sprintf("Failed to cancel workflow %s", workflowID))
	} else {
		logWorkflow(ctx, fmt.Sprintf("%s is cancelled successfully", workflowID))
	}
}

// signalExternalWorkflow sends a signal to an external workflow.
func signalExternalWorkflow(ctx workflow.Context, workflowID, signalName string, payload interface{}) error {
	return workflow.SignalExternalWorkflow(ctx, workflowID, "", signalName, payload).Get(ctx, nil)
}

// signalIfRunning sends a signal to a child workflow only if it is still
// running. Mirrors the TypeScript signalIfRunning utility.
func signalIfRunning(ctx workflow.Context, workflowID, signalName string, payload interface{}) {
	if workflowID == "" {
		return
	}
	isRunning, err := checkWorkflowRunning(ctx, workflowID)
	if err != nil {
		logWorkflow(ctx, fmt.Sprintf("Failed to check if workflow %s is running for signal %s", workflowID, signalName))
		return
	}
	if !isRunning {
		return
	}
	if err := signalExternalWorkflow(ctx, workflowID, signalName, payload); err != nil {
		logWorkflow(ctx, fmt.Sprintf("Failed to signal workflow %s with signal %s: %v", workflowID, signalName, err))
	}
}
