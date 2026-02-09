package activities

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/types"
)

// DirBatchInput contains the parameters for the CreateInitialDirBatch activity.
type DirBatchInput struct {
	JobRunID string   `json:"jobRunId"`
	Dirs     []string `json:"dirs"`
}

// GetTasksInput contains the parameters for the GetGroupOfTasks activity.
type GetTasksInput struct {
	JobRunID     string `json:"jobRunId"`
	ConsumerName string `json:"consumerName"`
	BatchSize    int64  `json:"batchSize"`
}

// GetTasksOutput contains the results of the GetGroupOfTasks activity.
type GetTasksOutput struct {
	Tasks   []types.Cmd `json:"tasks"`
	TaskIDs []string    `json:"taskIds"`
}

// CreateInitialDirBatch creates the initial directory batch in the Redis dir
// batch map. It returns the batch ID assigned to this batch.
func (a *Activities) CreateInitialDirBatch(ctx context.Context, input DirBatchInput) (string, error) {
	a.Logger.Info("CreateInitialDirBatch",
		zap.String("jobRunId", input.JobRunID),
		zap.Int("dirCount", len(input.Dirs)),
	)

	jobContext, err := a.getJobManagerContext(ctx, input.JobRunID)
	if err != nil {
		return "", fmt.Errorf("getting job manager context: %w", err)
	}

	batchID := uuid.New().String()

	if err := jobContext.SetBatchDir(ctx, batchID, input.Dirs); err != nil {
		return "", fmt.Errorf("setting batch dir %s: %w", batchID, err)
	}

	a.Logger.Info("CreateInitialDirBatch completed",
		zap.String("batchId", batchID),
		zap.Int("dirCount", len(input.Dirs)),
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
func (a *Activities) GetGroupOfTasks(ctx context.Context, input GetTasksInput) (*GetTasksOutput, error) {
	a.Logger.Info("GetGroupOfTasks",
		zap.String("jobRunId", input.JobRunID),
		zap.String("consumer", input.ConsumerName),
		zap.Int64("batchSize", input.BatchSize),
	)

	jobContext, err := a.getJobManagerContext(ctx, input.JobRunID)
	if err != nil {
		return nil, fmt.Errorf("getting job manager context: %w", err)
	}

	batchSize := input.BatchSize
	if batchSize <= 0 {
		batchSize = int64(a.Config.CommandsInTask)
	}

	messages, err := jobContext.GroupReadCommandStream(ctx, input.ConsumerName, batchSize)
	if err != nil {
		return nil, fmt.Errorf("reading command stream: %w", err)
	}

	output := &GetTasksOutput{
		Tasks:   make([]types.Cmd, 0, len(messages)),
		TaskIDs: make([]string, 0, len(messages)),
	}

	for _, msg := range messages {
		output.Tasks = append(output.Tasks, msg.Data)
		output.TaskIDs = append(output.TaskIDs, msg.ID)
	}

	// Acknowledge the messages.
	if len(output.TaskIDs) > 0 {
		if err := jobContext.GroupAckCommandStream(ctx, output.TaskIDs...); err != nil {
			a.Logger.Error("failed to acknowledge command stream messages",
				zap.Error(err),
			)
		}
	}

	a.Logger.Info("GetGroupOfTasks completed",
		zap.String("jobRunId", input.JobRunID),
		zap.Int("taskCount", len(output.Tasks)),
	)

	return output, nil
}
