package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// MigrationWorkflow is the parent workflow for migration jobs. It sets up
// workers, validates Redis memory, executes scan + sync child workflows in
// parallel, handles reporting, and cleans up.
//
// Registered with Temporal as "MigrationWorkflow" for wire compatibility with
// the TypeScript version.
func MigrationWorkflow(ctx workflow.Context, input MigrationWorkflowInput) (*MigrationWorkflowOutput, error) {
	output := &MigrationWorkflowOutput{
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

	// 5. Cleanup.
	executeCleanup(ctx, ExecuteCleanupInput{
		JobRunID:  input.TraceID,
		WorkerIDs: output.SetupCompletedWorkers,
		Options:   input.Options,
	})

	return output, nil
}
