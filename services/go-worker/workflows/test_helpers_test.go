package workflows

import (
	"context"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// registerAllActivities registers stub activity functions with the test
// workflow environment so that env.OnActivity("ActivityName", ...) works when
// the workflow calls activities by string name. Without this registration the
// Temporal test suite panics with "activity X is not registered".
//
// Each stub's signature must match the actual activity parameters so the
// Temporal test SDK can deserialize the inputs correctly. Since the test mocks
// override the return values anyway, the function bodies are irrelevant.
// registerAllWorkflows registers stub workflows for all child workflows that
// parent workflows may invoke via ExecuteChildWorkflow by string name. We use
// stubs (not real implementations) so that env.OnWorkflow mocks can intercept
// child workflow calls and return mock data without running the real code.
func registerAllWorkflows(env *testsuite.TestWorkflowEnvironment) {
	// Child workflows invoked by parent workflows.
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, input SetupWorkerInput) (*SetupWorkerOutput, error) { return nil, nil },
		workflow.RegisterOptions{Name: "SetupWorkerWorkflow"},
	)
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, input CleanupWorkerInput) error { return nil },
		workflow.RegisterOptions{Name: "CleanupWorkerWorkflow"},
	)
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, traceID string) (bool, error) { return true, nil },
		workflow.RegisterOptions{Name: "RedisMemoryCheckWorkflow"},
	)
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, input ChildScanWorkflowInput) (*ChildScanWorkflowOutput, error) {
			return nil, nil
		},
		workflow.RegisterOptions{Name: "ChildScanWorkflow"},
	)
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, input ChildSyncWorkflowInput) (*ChildSyncWorkflowOutput, error) {
			return nil, nil
		},
		workflow.RegisterOptions{Name: "ChildSyncWorkflow"},
	)

	// External workflows (not defined locally but invoked by child workflow calls).
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, input interface{}) error { return nil },
		workflow.RegisterOptions{Name: "GenerateDiscoveryReportWorkflow"},
	)
}

func registerAllActivities(env *testsuite.TestWorkflowEnvironment) {
	// Status / common activities
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input UpdateStatusInput) error { return nil },
		activity.RegisterOptions{Name: "UpdateStatus"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string, workerID string, response interface{}) error { return nil },
		activity.RegisterOptions{Name: "UpdateWorkerResponse"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "UpdateJobErrorStatus"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "UpdateLastEntry"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input UpdateCutOverStatusInput) error { return nil },
		activity.RegisterOptions{Name: "UpdateCutOverStatus"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "CleanupJobContext"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "CleanupWorker"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "SetupWorker"},
	)

	// Scan activities
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input CreateInitialDirBatchInput) (string, error) { return "", nil },
		activity.RegisterOptions{Name: "CreateInitialDirBatch"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) (bool, error) { return false, nil },
		activity.RegisterOptions{Name: "IsCmdStreamLenValid"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input ScanActivityInput) (ScanActivityOutput, error) {
			return ScanActivityOutput{}, nil
		},
		activity.RegisterOptions{Name: "ScanDirectories"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "ResolveUsernamesToSids"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "SetupExportPathPermission"},
	)

	// Sync activities
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) ([]string, error) { return nil, nil },
		activity.RegisterOptions{Name: "GetGroupOfTasks"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input SyncTaskActivityInput) (SyncTaskActivityOutput, error) {
			return SyncTaskActivityOutput{}, nil
		},
		activity.RegisterOptions{Name: "SyncTaskActivity"},
	)

	// Reporting activities
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "GenerateJobsReport"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "GenerateDiscoveryReport"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, jobRunID string) error { return nil },
		activity.RegisterOptions{Name: "GenerateCOCReport"},
	)

	// Utility activities
	env.RegisterActivityWithOptions(
		func(ctx context.Context, workflowID string) (bool, error) { return false, nil },
		activity.RegisterOptions{Name: "IsWorkflowRunning"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context) (bool, error) { return false, nil },
		activity.RegisterOptions{Name: "CheckMemoryUsage"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, traceID string, protocolType string, payload map[string]interface{}, feature map[string]interface{}) (map[string]interface{}, error) {
			return map[string]interface{}{
				"traceId":          traceID,
				"status":           "success",
				"protocolType":     protocolType,
				"hostname":         payload["hostname"],
				"workerId":         "test-worker",
				"paths":            []string{},
				"protocolVersions": []string{},
				"message":          "validated successfully",
			}, nil
		},
		activity.RegisterOptions{Name: "ValidateConnection"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input interface{}) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "ValidatePath"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input interface{}) error { return nil },
		activity.RegisterOptions{Name: "ValidateWorkingDirectory"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, input interface{}) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "PreCheckPath"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, traceID string, protocolType string, payload map[string]interface{}) (map[string]interface{}, error) {
			return map[string]interface{}{
				"traceId":      traceID,
				"status":       "success",
				"protocolType": protocolType,
				"hostname":     payload["hostname"],
				"workerId":     "test-worker",
				"paths":        []string{"/export1", "/export2"},
				"message":      "listed successfully",
			}, nil
		},
		activity.RegisterOptions{Name: "ListPaths"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, a, b, c string, d interface{}) error { return nil },
		activity.RegisterOptions{Name: "PostResultsActivity"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, traceID string, results interface{}) error { return nil },
		activity.RegisterOptions{Name: "PostValidationResult"},
	)

	// Speed test activities
	env.RegisterActivityWithOptions(
		func(ctx context.Context, payload interface{}, traceID string) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "WriteActivity"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, payload interface{}, traceID string) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "ReadActivity"},
	)
	env.RegisterActivityWithOptions(
		func(ctx context.Context, payload interface{}, traceID string) (interface{}, error) { return nil, nil },
		activity.RegisterOptions{Name: "NetworkPerformanceActivity"},
	)
}
