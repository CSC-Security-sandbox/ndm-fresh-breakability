package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// waitForApproval blocks until an "approve" signal is received with a value of
// "APPROVED" or "REJECTED". It registers an "isBlocked" query handler that
// returns true while waiting. After receiving the signal, it calls the
// UpdateCutOverStatus activity. Matches the TypeScript waitForApproval function.
func waitForApproval(ctx workflow.Context, jobRunID string) (string, error) {
	logger := workflow.GetLogger(ctx)

	isBlocked := true
	var approvalStatus string

	// Register query handler for isBlocked.
	err := workflow.SetQueryHandler(ctx, QueryIsBlocked, func() (bool, error) {
		return isBlocked, nil
	})
	if err != nil {
		return "", fmt.Errorf("failed to set isBlocked query handler: %w", err)
	}

	// Set up approve signal handler.
	approveCh := workflow.GetSignalChannel(ctx, SignalApprove)
	workflow.Go(ctx, func(gCtx workflow.Context) {
		var input string
		approveCh.Receive(gCtx, &input)
		logger.Info(fmt.Sprintf("Received approval input: %s", input))
		if input == CutOverStatusApproved || input == CutOverStatusRejected {
			approvalStatus = input
			isBlocked = false
		}
	})

	logger.Info("Waiting for approval...")

	// Wait until the approval signal is received.
	_ = workflow.Await(ctx, func() bool {
		return !isBlocked
	})

	// Update cutover status.
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Hour,
		RetryPolicy:         shortActivityOptions().RetryPolicy,
	})
	if err := workflow.ExecuteActivity(actCtx, "UpdateCutOverStatus", UpdateCutOverStatusInput{
		JobRunID: jobRunID,
		Status:   approvalStatus,
	}).Get(ctx, nil); err != nil {
		return "", fmt.Errorf("failed to update cutover status: %w", err)
	}

	logger.Info(fmt.Sprintf("Cutover approval received: %s", approvalStatus))

	if approvalStatus == "" {
		return "No approval received", nil
	}
	return approvalStatus, nil
}
