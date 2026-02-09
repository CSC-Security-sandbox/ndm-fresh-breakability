package workflows

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// ---------------------------------------------------------------------------
// MigrationWorkflow tests
// ---------------------------------------------------------------------------

func TestMigrationWorkflow_HappyPath(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)
	registerAllWorkflows(env)

	// executeWorkerSetup -> SetupWorkerWorkflow.
	env.OnWorkflow("SetupWorkerWorkflow", mock.Anything, mock.Anything).Return(
		&SetupWorkerOutput{Status: "success", WorkerID: "worker-1"}, nil)

	env.OnActivity("UpdateWorkerResponse", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil).Maybe()
	env.OnActivity("UpdateJobErrorStatus", mock.Anything, mock.Anything).Return(nil).Maybe()

	// RedisMemoryCheckWorkflow.
	env.OnWorkflow("RedisMemoryCheckWorkflow", mock.Anything, mock.Anything).Return(true, nil)

	// Migration child workflows: ChildScanWorkflow + ChildSyncWorkflow.
	env.OnWorkflow("ChildScanWorkflow", mock.Anything, mock.Anything).Return(
		&ChildScanWorkflowOutput{
			JobRunID:  "mig-trace-1",
			FileCount: 200,
			DirCount:  25,
			Status:    StatusCompleted,
		}, nil)

	env.OnWorkflow("ChildSyncWorkflow", mock.Anything, mock.Anything).Return(
		&ChildSyncWorkflowOutput{
			JobRunID: "mig-trace-1",
			Status:   StatusCompleted,
		}, nil)

	// IsWorkflowRunning (used by signalIfRunning).
	env.OnActivity("IsWorkflowRunning", mock.Anything, mock.Anything).Return(false, nil).Maybe()

	// UpdateStatus.
	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	// UpdateLastEntry.
	env.OnActivity("UpdateLastEntry", mock.Anything, mock.Anything).Return(nil)

	// handleReporting: send reporting signal.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalReporting, JobReportTypeMigrate)
	}, 0)

	// GenerateCOCReport activity.
	env.OnActivity("GenerateCOCReport", mock.Anything, mock.Anything).Return(nil).Maybe()

	// CleanupWorkerWorkflow child.
	env.OnWorkflow("CleanupWorkerWorkflow", mock.Anything, mock.Anything).Return(nil)

	// CleanupJobContext.
	env.OnActivity("CleanupJobContext", mock.Anything, mock.Anything).Return(nil, nil)

	input := MigrationWorkflowInput{
		TraceID: "mig-trace-1",
		Payload: MigrationPayload{
			Workers: []string{"worker-1"},
		},
	}

	env.ExecuteWorkflow(MigrationWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output MigrationWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, "mig-trace-1", output.TraceID)
	assert.Equal(t, 200, output.FileCount)
	assert.Equal(t, 25, output.DirCount)
	assert.Contains(t, output.SetupCompletedWorkers, "worker-1")
	assert.Empty(t, output.FailedWorkers)
}

func TestMigrationWorkflow_MultipleWorkers(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)
	registerAllWorkflows(env)

	// Both workers succeed.
	env.OnWorkflow("SetupWorkerWorkflow", mock.Anything, mock.Anything).Return(
		&SetupWorkerOutput{Status: "success", WorkerID: "w"}, nil)

	env.OnActivity("UpdateWorkerResponse", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil).Maybe()
	env.OnActivity("UpdateJobErrorStatus", mock.Anything, mock.Anything).Return(nil).Maybe()

	env.OnWorkflow("RedisMemoryCheckWorkflow", mock.Anything, mock.Anything).Return(true, nil)

	env.OnWorkflow("ChildScanWorkflow", mock.Anything, mock.Anything).Return(
		&ChildScanWorkflowOutput{
			JobRunID:  "multi-mig",
			FileCount: 50,
			DirCount:  5,
			Status:    StatusCompleted,
		}, nil)

	env.OnWorkflow("ChildSyncWorkflow", mock.Anything, mock.Anything).Return(
		&ChildSyncWorkflowOutput{
			JobRunID: "multi-mig",
			Status:   StatusCompleted,
		}, nil)

	env.OnActivity("IsWorkflowRunning", mock.Anything, mock.Anything).Return(false, nil).Maybe()
	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("UpdateLastEntry", mock.Anything, mock.Anything).Return(nil)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalReporting, JobReportTypeMigrate)
	}, 0)

	env.OnActivity("GenerateCOCReport", mock.Anything, mock.Anything).Return(nil).Maybe()
	env.OnWorkflow("CleanupWorkerWorkflow", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("CleanupJobContext", mock.Anything, mock.Anything).Return(nil, nil)

	input := MigrationWorkflowInput{
		TraceID: "multi-mig",
		Payload: MigrationPayload{
			Workers: []string{"worker-1", "worker-2"},
		},
	}

	env.ExecuteWorkflow(MigrationWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output MigrationWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Len(t, output.SetupCompletedWorkers, 2)
}
