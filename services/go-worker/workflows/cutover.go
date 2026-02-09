package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// CutOverWorkFlow is the parent workflow for cutover jobs. It is identical to
// MigrationWorkflow but adds an approval step after reporting and before
// cleanup. The workflow blocks waiting for an "approve" signal.
//
// Registered with Temporal as "CutOverWorkFlow" (note: uppercase F in "Flow")
// for wire compatibility with the TypeScript version.
func CutOverWorkFlow(ctx workflow.Context, input CutOverWorkflowInput) (*CutOverWorkflowOutput, error) {
	output := &CutOverWorkflowOutput{
		TraceID:               input.TraceID,
		SetupCompletedWorkers: []string{},
		FailedWorkers:         []string{},
		Status:                StatusReady,
	}

	// 1. Setup workers.
	setupResult, err := executeWorkerSetup(ctx, ExecuteWorkerSetupInput{
		JobRunID:  input.TraceID,
		WorkerIDs: input.Payload.Workers,
		Options:   input.Options,
	})
	if err != nil {
		return nil, err
	}
	output.SetupCompletedWorkers = setupResult.SetupCompletedWorkers
	output.FailedWorkers = setupResult.FailedWorkers

	// 2. Validate Redis memory.
	waitUntilRedisMemoryOk(ctx, input.TraceID)

	// 3. Execute migration child workflows (scan + sync in parallel).
	migrationResult, err := executeMigrationChildWorkflows(ctx, input.TraceID)
	if err != nil {
		return nil, err
	}
	output.FileCount = migrationResult.FileCount
	output.DirCount = migrationResult.DirCount
	output.Status = migrationResult.Status

	// 4. Reporting and report generation.
	if _, err := handleReporting(ctx, input.TraceID, output.Status); err != nil {
		return nil, err
	}

	// 5. Wait for approval (blocks until "approve" signal is received).
	if _, err := waitForApproval(ctx, input.TraceID); err != nil {
		return nil, err
	}

	// 6. Cleanup.
	executeCleanup(ctx, ExecuteCleanupInput{
		JobRunID:  input.TraceID,
		WorkerIDs: output.SetupCompletedWorkers,
		Options:   input.Options,
	})

	return output, nil
}
