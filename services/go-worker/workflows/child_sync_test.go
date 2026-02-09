package workflows

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// ---------------------------------------------------------------------------
// ChildSyncWorkflow tests
// ---------------------------------------------------------------------------

func TestChildSyncWorkflow_HappyPath(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	// Mock UpdateStatus activity.
	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	// Return no tasks. Scan is already completed so loop exits immediately.
	env.OnActivity("GetGroupOfTasks", mock.Anything, mock.Anything).Return([]string{}, nil)

	// Mock SyncTaskActivity (may not be called but register just in case).
	env.OnActivity("SyncTaskActivity", mock.Anything, mock.Anything).Return(
		SyncTaskActivityOutput{}, nil).Maybe()

	// Send scan completed signal shortly after start.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalScanResult, StatusCompleted)
	}, 0)

	input := ChildSyncWorkflowInput{
		JobRunID:           "sync-job-1",
		ScanWorkflowStatus: StatusRunning,
	}

	env.ExecuteWorkflow(ChildSyncWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildSyncWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusCompleted, output.Status)
	assert.Equal(t, "sync-job-1", output.JobRunID)
}

func TestChildSyncWorkflow_StopSignal(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("GetGroupOfTasks", mock.Anything, mock.Anything).Return([]string{"task-1"}, nil)
	env.OnActivity("SyncTaskActivity", mock.Anything, mock.Anything).Return(SyncTaskActivityOutput{}, nil)

	// Send stop signal.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalSyncAction, StatusStopped)
	}, 0)

	input := ChildSyncWorkflowInput{
		JobRunID:           "sync-stop-job",
		ScanWorkflowStatus: StatusRunning,
	}

	env.ExecuteWorkflow(ChildSyncWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildSyncWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusStopped, output.Status)
}

func TestChildSyncWorkflow_ScanAlreadyCompleted(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	// No tasks available, and scan is already completed -> exit.
	env.OnActivity("GetGroupOfTasks", mock.Anything, mock.Anything).Return([]string{}, nil)

	input := ChildSyncWorkflowInput{
		JobRunID:           "sync-done-job",
		ScanWorkflowStatus: StatusCompleted,
	}

	env.ExecuteWorkflow(ChildSyncWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildSyncWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusCompleted, output.Status)
}

func TestChildSyncWorkflow_DefaultsApplied(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("GetGroupOfTasks", mock.Anything, mock.Anything).Return([]string{}, nil)

	// Provide minimal input to test default application.
	input := ChildSyncWorkflowInput{
		JobRunID:           "sync-defaults",
		ScanWorkflowStatus: StatusCompleted,
	}

	env.ExecuteWorkflow(ChildSyncWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}
