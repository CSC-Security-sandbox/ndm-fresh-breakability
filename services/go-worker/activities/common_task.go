package activities

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	enumspb "go.temporal.io/api/enums/v1"
	"go.uber.org/zap"
)

// DirBatchInput contains the parameters for the CreateInitialDirBatch activity.
// Wire-compatible with the TypeScript {dirsToScan, jobRunId} shape.
type DirBatchInput struct {
	JobRunID   string   `json:"jobRunId"`
	DirsToScan []string `json:"dirsToScan"`
}

// CreateInitialDirBatch creates the initial directory batch in the Redis dir
// batch map. It returns the batch ID assigned to this batch.
func (a *Activities) CreateInitialDirBatch(ctx context.Context, input DirBatchInput) (string, error) {
	a.Logger.Info("CreateInitialDirBatch",
		zap.String("jobRunId", input.JobRunID),
		zap.Int("dirCount", len(input.DirsToScan)),
	)

	jobContext, err := a.getJobManagerContext(ctx, input.JobRunID)
	if err != nil {
		return "", fmt.Errorf("getting job manager context: %w", err)
	}

	batchID := uuid.New().String()

	if err := jobContext.SetBatchDir(ctx, batchID, input.DirsToScan); err != nil {
		return "", fmt.Errorf("setting batch dir %s: %w", batchID, err)
	}

	a.Logger.Info("CreateInitialDirBatch completed",
		zap.String("batchId", batchID),
		zap.Int("dirCount", len(input.DirsToScan)),
	)

	return batchID, nil
}

// IsCmdStreamLenValid checks whether the command stream length is within
// the configured maximum. Returns true if more commands can be added.
func (a *Activities) IsCmdStreamLenValid(ctx context.Context, jobRunID string) (bool, error) {
	a.Logger.Debug("IsCmdStreamLenValid", zap.String("jobRunId", jobRunID))

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		return false, fmt.Errorf("getting job manager context: %w", err)
	}

	length, err := jobContext.GetCommandStreamLength(ctx)
	if err != nil {
		return false, fmt.Errorf("getting command stream length: %w", err)
	}

	maxCmds := int64(a.Config.MaxCmdsInStream)
	if maxCmds <= 0 {
		maxCmds = 5000
	}

	isValid := length < maxCmds

	a.Logger.Debug("command stream length check",
		zap.String("jobRunId", jobRunID),
		zap.Int64("length", length),
		zap.Int64("max", maxCmds),
		zap.Bool("isValid", isValid),
	)

	return isValid, nil
}

// GetGroupOfTasks reads a batch of commands from the Redis command stream
// using consumer group reads.
//
// The TypeScript version is called as getGroupOfTasksActivity(jobRunId) with a
// single string argument, so the Go signature matches: (ctx, jobRunID string).
func (a *Activities) GetGroupOfTasks(ctx context.Context, jobRunID string) ([]string, error) {
	a.Logger.Info("GetGroupOfTasks",
		zap.String("jobRunId", jobRunID),
	)

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		return nil, fmt.Errorf("getting job manager context: %w", err)
	}

	batchSize := int64(a.Config.CommandsInTask)
	if batchSize <= 0 {
		batchSize = 100
	}

	consumerName := fmt.Sprintf("consumer-%s", jobRunID)
	messages, err := jobContext.GroupReadCommandStream(ctx, consumerName, batchSize)
	if err != nil {
		return nil, fmt.Errorf("reading command stream: %w", err)
	}

	taskIDs := make([]string, 0, len(messages))
	for _, msg := range messages {
		taskIDs = append(taskIDs, msg.ID)
	}

	// Acknowledge the messages.
	if len(taskIDs) > 0 {
		if err := jobContext.GroupAckCommandStream(ctx, taskIDs...); err != nil {
			a.Logger.Error("failed to acknowledge command stream messages",
				zap.Error(err),
			)
		}
	}

	a.Logger.Info("GetGroupOfTasks completed",
		zap.String("jobRunId", jobRunID),
		zap.Int("taskCount", len(taskIDs)),
	)

	return taskIDs, nil
}

// IsWorkflowRunning checks whether a workflow with the given ID is currently
// running by querying Temporal's DescribeWorkflowExecution API.
// Matches the TypeScript isWorkflowRunningActivity.
func (a *Activities) IsWorkflowRunning(ctx context.Context, workflowID string) (bool, error) {
	a.Logger.Debug("IsWorkflowRunning", zap.String("workflowId", workflowID))

	if a.TemporalClient == nil {
		return false, fmt.Errorf("temporal client not available")
	}

	resp, err := a.TemporalClient.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		a.Logger.Error("failed to describe workflow execution",
			zap.String("workflowId", workflowID),
			zap.Error(err),
		)
		return false, nil // Return false on error, matching TS behavior
	}

	if resp.WorkflowExecutionInfo == nil {
		return false, nil
	}

	isRunning := resp.WorkflowExecutionInfo.Status == enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING

	a.Logger.Debug("IsWorkflowRunning result",
		zap.String("workflowId", workflowID),
		zap.Bool("isRunning", isRunning),
	)

	return isRunning, nil
}
