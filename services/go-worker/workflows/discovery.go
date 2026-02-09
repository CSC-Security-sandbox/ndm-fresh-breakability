package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// DiscoveryWorkflow is the parent workflow for discovery jobs. It sets up
// workers, validates Redis memory, executes a discovery scan via child
// workflows, handles reporting, and cleans up.
//
// Registered with Temporal as "DiscoveryWorkflow" for wire compatibility with
// the TypeScript version.
func DiscoveryWorkflow(ctx workflow.Context, input DiscoveryWorkflowInput) (*DiscoveryWorkflowOutput, error) {
	output := &DiscoveryWorkflowOutput{
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

	// 3. Execute discovery child workflows (scan only, no migration).
	discoveryResult, err := executeDiscoveryChildWorkflows(ctx, input.TraceID)
	if err != nil {
		return nil, err
	}
	output.FileCount = discoveryResult.FileCount
	output.DirCount = discoveryResult.DirCount
	output.Status = discoveryResult.Status

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

// waitUntilRedisMemoryOk starts a RedisMemoryCheckWorkflow as a child
// workflow and waits for it to confirm that Redis memory is within acceptable
// limits. Matches the TypeScript waitUntilRedisMemoryOk utility.
func waitUntilRedisMemoryOk(ctx workflow.Context, traceID string) {
	childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowID: "RedisMemoryCheckWorkflow-" + traceID,
	})
	_ = workflow.ExecuteChildWorkflow(childCtx, "RedisMemoryCheckWorkflow", traceID).Get(ctx, nil)
}
