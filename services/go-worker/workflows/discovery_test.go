package workflows

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// ---------------------------------------------------------------------------
// DiscoveryWorkflow tests
// ---------------------------------------------------------------------------

func TestDiscoveryWorkflow_HappyPath(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerAllActivities(env)
	registerAllWorkflows(env)

	// Mock all activities used in discovery workflow.

	// executeWorkerSetup -> SetupWorkerWorkflow child workflow.
	env.OnWorkflow("SetupWorkerWorkflow", mock.Anything, mock.Anything).Return(
		&SetupWorkerOutput{Status: "success", WorkerID: "worker-1"}, nil)

	// UpdateWorkerResponse (may be called for failures).
	env.OnActivity("UpdateWorkerResponse", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil).Maybe()

	// UpdateJobErrorStatus (called when all workers fail).
	env.OnActivity("UpdateJobErrorStatus", mock.Anything, mock.Anything).Return(nil).Maybe()

	// RedisMemoryCheckWorkflow child workflow.
	env.OnWorkflow("RedisMemoryCheckWorkflow", mock.Anything, mock.Anything).Return(true, nil)

	// Discovery child workflows: ChildScanWorkflow.
	env.OnWorkflow("ChildScanWorkflow", mock.Anything, mock.Anything).Return(
		&ChildScanWorkflowOutput{
			JobRunID:  "trace-123",
			FileCount: 100,
			DirCount:  10,
			Status:    StatusCompleted,
		}, nil)

	// UpdateStatus activity.
	env.OnActivity("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	// UpdateLastEntry activity.
	env.OnActivity("UpdateLastEntry", mock.Anything, mock.Anything).Return(nil)

	// IsWorkflowRunning activity (used by signalIfRunning/cancelWorkflowIfRunning).
	env.OnActivity("IsWorkflowRunning", mock.Anything, mock.Anything).Return(false, nil).Maybe()

	// handleReporting: will receive a reporting signal.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalReporting, JobReportTypeDiscover)
	}, 0)

	// GenerateDiscoveryReportWorkflow child workflow.
	env.OnWorkflow("GenerateDiscoveryReportWorkflow", mock.Anything, mock.Anything).Return(nil).Maybe()

	// CleanupWorkerWorkflow child workflow.
	env.OnWorkflow("CleanupWorkerWorkflow", mock.Anything, mock.Anything).Return(nil)

	// CleanupJobContext activity.
	env.OnActivity("CleanupJobContext", mock.Anything, mock.Anything).Return(nil, nil)

	input := DiscoveryWorkflowInput{
		TraceID: "trace-123",
		Payload: DiscoveryPayload{
			Workers: []string{"worker-1"},
		},
	}

	env.ExecuteWorkflow(DiscoveryWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var output DiscoveryWorkflowOutput
	require.NoError(t, env.GetWorkflowResult(&output))
	assert.Equal(t, "trace-123", output.TraceID)
	assert.Equal(t, 100, output.FileCount)
	assert.Equal(t, 10, output.DirCount)
	assert.Contains(t, output.SetupCompletedWorkers, "worker-1")
	assert.Empty(t, output.FailedWorkers)
}

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

func TestIsScanFinished(t *testing.T) {
	assert.True(t, isScanFinished(StatusCompleted))
	assert.True(t, isScanFinished(StatusFailed))
	assert.False(t, isScanFinished(StatusRunning))
	assert.False(t, isScanFinished(StatusPaused))
	assert.False(t, isScanFinished(StatusStopped))
}

func TestGetUnifiedJobStatus(t *testing.T) {
	// Either failed -> FAILED.
	assert.Equal(t, StatusFailed, getUnifiedJobStatus(StatusFailed, StatusCompleted))
	assert.Equal(t, StatusFailed, getUnifiedJobStatus(StatusCompleted, StatusFailed))

	// Either stopped -> STOPPED.
	assert.Equal(t, StatusStopped, getUnifiedJobStatus(StatusStopped, StatusCompleted))
	assert.Equal(t, StatusStopped, getUnifiedJobStatus(StatusCompleted, StatusStopped))

	// Both completed -> COMPLETED.
	assert.Equal(t, StatusCompleted, getUnifiedJobStatus(StatusCompleted, StatusCompleted))

	// Failed takes precedence over stopped.
	assert.Equal(t, StatusFailed, getUnifiedJobStatus(StatusFailed, StatusStopped))
}

func TestGetMappedJobRunStatus(t *testing.T) {
	assert.Equal(t, StatusBlocked, getMappedJobRunStatus(StatusCompleted, JobReportTypeCutOver))
	assert.Equal(t, StatusCompleted, getMappedJobRunStatus(StatusCompleted, JobReportTypeMigrate))
	assert.Equal(t, StatusFailed, getMappedJobRunStatus(StatusFailed, JobReportTypeCutOver))
}
