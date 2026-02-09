package workflows

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// ---------------------------------------------------------------------------
// ChildScanWorkflow tests
// ---------------------------------------------------------------------------

func TestChildScanWorkflow_HappyPath(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	// Mock UpdateStatus activity.
	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	// Mock CreateInitialDirBatch activity.
	env.OnActivity("CreateInitialDirBatch", mock.Anything, mock.Anything).Return("batch-1", nil)

	// Mock IsCmdStreamLenValid activity.
	env.OnActivity("IsCmdStreamLenValid", mock.Anything, mock.Anything).Return(true, nil)

	// Mock ScanDirectories activity - returns no further subdirs to stop the loop.
	env.OnActivity("ScanDirectories", mock.Anything, mock.Anything).Return(
		ScanActivityOutput{
			FileCount: 10,
			DirCount:  2,
			BatchDirs: []string{},
		}, nil)

	input := ChildScanWorkflowInput{
		JobRunID:      "job-run-1",
		IsInitialScan: true,
		IsMigration:   false,
		BatchSize:     100,
	}

	env.ExecuteWorkflow(ChildScanWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildScanWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusCompleted, output.Status)
	assert.Equal(t, 10, output.FileCount)
	assert.Equal(t, 2, output.DirCount)
	assert.Equal(t, "job-run-1", output.JobRunID)
}

func TestChildScanWorkflow_DefaultsApplied(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("CreateInitialDirBatch", mock.Anything, mock.Anything).Return("batch-1", nil)
	env.OnActivity("ScanDirectories", mock.Anything, mock.Anything).Return(
		ScanActivityOutput{FileCount: 5, DirCount: 1, BatchDirs: []string{}}, nil)

	// Provide minimal input, let defaults be applied.
	input := ChildScanWorkflowInput{
		JobRunID:      "job-defaults",
		IsInitialScan: true,
	}

	env.ExecuteWorkflow(ChildScanWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildScanWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusCompleted, output.Status)
}

func TestChildScanWorkflow_StopSignal(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("CreateInitialDirBatch", mock.Anything, mock.Anything).Return("batch-1", nil)

	// ScanDirectories returns subdirs to keep the loop going.
	env.OnActivity("ScanDirectories", mock.Anything, mock.Anything).Return(
		ScanActivityOutput{FileCount: 1, DirCount: 1, BatchDirs: []string{"batch-2"}}, nil)

	// Send stop signal before the second iteration.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalScanAction, StatusStopped)
	}, 0)

	input := ChildScanWorkflowInput{
		JobRunID:      "job-stop",
		IsInitialScan: true,
		IsMigration:   false,
	}

	env.ExecuteWorkflow(ChildScanWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildScanWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusStopped, output.Status)
}

func TestChildScanWorkflow_MigrationPath(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("ResolveUsernamesToSids", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("SetupExportPathPermission", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("CreateInitialDirBatch", mock.Anything, mock.Anything).Return("batch-1", nil)
	env.OnActivity("IsCmdStreamLenValid", mock.Anything, mock.Anything).Return(true, nil)
	env.OnActivity("ScanDirectories", mock.Anything, mock.Anything).Return(
		ScanActivityOutput{FileCount: 20, DirCount: 5, BatchDirs: []string{}}, nil)

	input := ChildScanWorkflowInput{
		JobRunID:      "job-migration-1",
		IsInitialScan: true,
		IsMigration:   true,
	}

	env.ExecuteWorkflow(ChildScanWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildScanWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusCompleted, output.Status)
	assert.Equal(t, 20, output.FileCount)
	assert.Equal(t, 5, output.DirCount)
}

func TestChildScanWorkflow_NoBatches(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)

	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	// No initial scan and no batch IDs -> loop doesn't execute.
	input := ChildScanWorkflowInput{
		JobRunID:      "job-no-batches",
		IsInitialScan: false,
		DirBatchIds:   []string{},
	}

	env.ExecuteWorkflow(ChildScanWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output ChildScanWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, StatusCompleted, output.Status)
}
