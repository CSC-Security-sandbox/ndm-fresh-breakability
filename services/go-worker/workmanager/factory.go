package workmanager

import (
	"go.temporal.io/sdk/worker"

	"github.com/netapp/ndm/services/go-worker/activities"
	"github.com/netapp/ndm/services/go-worker/workflows"
)

// registerWorkflows registers the appropriate set of workflow functions on the
// Temporal worker based on the WorkerType.
//
// The mapping mirrors the TypeScript worker's registration logic:
//   - PARENT_WORKFLOW  : top-level orchestration workflows
//   - WORKER_SPECIFIC  : utility and validation workflows scoped to a worker
//   - JOB_SPECIFIC     : child workflows that scan/sync for a single job run
func registerWorkflows(w worker.Worker, wtype WorkerType) {
	switch wtype {
	case ParentWorkflow:
		// Parent orchestration workflows that run on ParentWorkflow-TaskQueue.
		// These dispatch child workflows to per-worker or per-job task queues.
		w.RegisterWorkflow(workflows.DiscoveryWorkflow)
		w.RegisterWorkflow(workflows.MigrationWorkflow)
		w.RegisterWorkflow(workflows.CutOverWorkFlow)
		// ValidateConnectionsWorkflow is the parent orchestrator that dispatches
		// ValidateWorkerConnectionWorkflow children on per-worker task queues.
		w.RegisterWorkflow(workflows.ValidateConnectionsWorkflow)
		// ValidatePathsWorkflow (with "s") matches TS WorkFlows.VALIDATE_PATHS.
		w.RegisterWorkflow(workflows.ValidatePathsWorkflow)
		w.RegisterWorkflow(workflows.ListPathsWorkflow)
		// PreCheckValidationWorkflow matches TS function name.
		w.RegisterWorkflow(workflows.PreCheckValidationWorkflow)
		w.RegisterWorkflow(workflows.SpeedTestWorkflow)
		// ValidateWorkingDirectoryWorkflow matches TS WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY.
		w.RegisterWorkflow(workflows.ValidateWorkingDirectoryWorkflow)

	case WorkerSpecific:
		// Per-worker workflows that run on ${workerId}-TaskQueue.
		w.RegisterWorkflow(workflows.SetupWorkerWorkflow)
		w.RegisterWorkflow(workflows.CleanupWorkerWorkflow)
		// ValidateWorkerConnectionWorkflow is the per-worker child that
		// calls the ValidateConnection activity for each protocol.
		w.RegisterWorkflow(workflows.ValidateWorkerConnectionWorkflow)
		// ValidatePathWorkerWorkflow is the per-worker child for path validation.
		w.RegisterWorkflow(workflows.ValidatePathWorkerWorkflow)
		// ListPathWorkerWorkflow is the per-worker child that calls the
		// ListPaths activity for each protocol.
		w.RegisterWorkflow(workflows.ListPathWorkerWorkflow)
		// PreCheckWorkerValidationWorkflow is the per-worker child for pre-checks.
		w.RegisterWorkflow(workflows.PreCheckWorkerValidationWorkflow)
		// SpeedTestJobWorkflow is the per-worker child that runs speed tests.
		w.RegisterWorkflow(workflows.SpeedTestJobWorkflow)
		w.RegisterWorkflow(workflows.RedisMemoryCheckWorkflow)
		// ValidateWorkingDirectoryWorkerWorkflow is the per-worker child.
		w.RegisterWorkflow(workflows.ValidateWorkingDirectoryWorkerWorkflow)

	case JobSpecific:
		w.RegisterWorkflow(workflows.ChildScanWorkflow)
		w.RegisterWorkflow(workflows.ChildSyncWorkflow)
	}
}

// registerActivities registers the Activities struct (all of its exported
// methods) on the Temporal worker. Every worker type needs access to
// activities, so registration is the same regardless of type. If a more
// granular split is needed in the future, the wtype parameter can be used to
// selectively register individual methods.
func registerActivities(w worker.Worker, acts *activities.Activities, wtype WorkerType) {
	// Registering the struct causes all exported methods to be available as
	// activities. This matches the Temporal Go SDK convention.
	w.RegisterActivity(acts)
}
