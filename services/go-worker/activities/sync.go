package activities

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"

	"go.temporal.io/sdk/activity"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/types"
)

// SyncInput contains the parameters for the SyncTaskActivity.
type SyncInput struct {
	JobRunID string `json:"jobRunId"`
	TaskID   string `json:"taskId"`
}

// SyncOutput contains the results of the SyncTaskActivity.
type SyncOutput struct {
	SourceErrors int    `json:"sourceErrors"`
	TargetErrors int    `json:"targetErrors"`
	Status       string `json:"status"`
}

// SyncTaskActivity processes all commands for a given task by fetching them
// from Redis and executing them concurrently in slices of MaxCommandConcurrency.
func (a *Activities) SyncTaskActivity(ctx context.Context, input SyncInput) (*SyncOutput, error) {
	a.Logger.Info("SyncTaskActivity started",
		zap.String("jobRunId", input.JobRunID),
		zap.String("taskId", input.TaskID),
	)

	jobContext, err := a.getJobManagerContext(ctx, input.JobRunID)
	if err != nil {
		return nil, fmt.Errorf("getting job manager context: %w", err)
	}

	// Get the task info.
	taskInfo, err := jobContext.GetTask(ctx, input.TaskID)
	if err != nil {
		return nil, fmt.Errorf("getting task %s: %w", input.TaskID, err)
	}
	if taskInfo == nil {
		return nil, fmt.Errorf("task %s not found", input.TaskID)
	}

	cfg := jobContext.JobConfig
	if cfg == nil {
		return nil, fmt.Errorf("job config not found for %s", input.JobRunID)
	}

	// Resolve source and target paths.
	sourcePrefix := a.getMountPath(input.JobRunID, cfg.SourceFileServer.PathID)
	sourcePath := filepath.Join(sourcePrefix, cfg.SourcePath)

	var targetPath string
	if cfg.DestinationFileServer != nil {
		targetPrefix := a.getMountPath(input.JobRunID, cfg.DestinationFileServer.PathID)
		targetPath = filepath.Join(targetPrefix, cfg.DestinationPath)
	}

	errorType := types.ErrorTypeTransient

	concurrency := a.Config.MaxCommandConcurrency
	if concurrency <= 0 {
		concurrency = 100
	}

	commands := taskInfo.Commands
	if len(commands) == 0 {
		return &SyncOutput{Status: types.TaskStatusCompleted}, nil
	}

	var totalSourceErrors int64
	var totalTargetErrors int64

	// Process commands in slices of MaxCommandConcurrency.
	for start := 0; start < len(commands); start += concurrency {
		// Check context cancellation.
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		end := start + concurrency
		if end > len(commands) {
			end = len(commands)
		}

		slice := commands[start:end]

		// Record heartbeat.
		activity.RecordHeartbeat(ctx, fmt.Sprintf("processing commands %d-%d of %d", start+1, end, len(commands)))

		// Execute slice in parallel.
		var wg sync.WaitGroup
		for _, cmd := range slice {
			wg.Add(1)
			go func(c types.Cmd) {
				defer wg.Done()

				execInput := CommandExecInput{
					Command:    c,
					JobContext: jobContext,
					SourcePath: sourcePath,
					TargetPath: targetPath,
					ErrorType:  errorType,
				}

				result, execErr := a.ExecuteCommand(execInput)
				if execErr != nil {
					a.Logger.Error("command execution failed",
						zap.String("commandId", c.ID),
						zap.Error(execErr),
					)
					atomic.AddInt64(&totalSourceErrors, 1)
					return
				}

				if result != nil {
					atomic.AddInt64(&totalSourceErrors, int64(len(result.SourceErrors)))
					atomic.AddInt64(&totalTargetErrors, int64(len(result.TargetErrors)))
				}
			}(cmd)
		}
		wg.Wait()
	}

	status := types.TaskStatusCompleted
	if totalSourceErrors > 0 || totalTargetErrors > 0 {
		status = types.TaskStatusCompletedWithError
	}

	output := &SyncOutput{
		SourceErrors: int(totalSourceErrors),
		TargetErrors: int(totalTargetErrors),
		Status:       status,
	}

	a.Logger.Info("SyncTaskActivity completed",
		zap.String("jobRunId", input.JobRunID),
		zap.String("taskId", input.TaskID),
		zap.String("status", status),
		zap.Int("sourceErrors", output.SourceErrors),
		zap.Int("targetErrors", output.TargetErrors),
	)

	return output, nil
}
