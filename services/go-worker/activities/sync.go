package activities

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
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
//
// This matches the TypeScript sync-activity.service.ts lifecycle:
//  1. Get task from TaskMap by hash key
//  2. Validate task (check retry count, mark commands IN_PROCESS)
//  3. Set task status to RUNNING, publish to TaskStream
//  4. Execute all commands concurrently
//  5. Update and report final task status, delete from TaskMap
func (a *Activities) SyncTaskActivity(ctx context.Context, input SyncInput) (*SyncOutput, error) {
	a.Logger.Info("SyncTaskActivity started",
		zap.String("jobRunId", input.JobRunID),
		zap.String("taskId", input.TaskID),
	)

	jobContext, err := a.getJobManagerContext(ctx, input.JobRunID)
	if err != nil {
		return nil, fmt.Errorf("getting job manager context: %w", err)
	}

	// Get the task info from TaskMap by hash key.
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

	// --- Ensure task is valid (matches TS ensureTaskValid) ---

	// Check retry count — if exceeded, mark as ERRORED and bail out.
	maxRetry := a.Config.MaxRetryCount
	if maxRetry <= 0 {
		maxRetry = 3
	}
	if taskInfo.RetryCount >= maxRetry {
		taskInfo.Status = types.TaskStatusErrored
		_ = jobContext.PublishToTaskStream(ctx, *taskInfo)
		_ = jobContext.DeleteTask(ctx, input.TaskID)
		return nil, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("task %s exceeded max retry count %d", input.TaskID, maxRetry),
			"RetryExceededError", nil)
	}

	// Mark non-completed commands as IN_PROCESS.
	for i := range taskInfo.Commands {
		if taskInfo.Commands[i].Status != types.CommandStatusCompleted {
			taskInfo.Commands[i].Status = types.CommandStatusInProcess
		}
	}

	// Set task status to RUNNING and publish to TaskStream for progress tracking.
	taskInfo.Status = types.TaskStatusRunning
	taskInfo.WorkerID = a.Config.WorkerID
	_ = jobContext.PublishToTaskStream(ctx, *taskInfo)

	// --- Resolve source and target paths ---
	// Use mount path only (no cfg.SourcePath appending), matching the TS
	// basePrefix(task.jobRunId, task.sPathId). The command's FPath is a
	// relative path from the mount root and is joined later in ExecuteCommand.
	sourcePath := a.getMountPath(input.JobRunID, taskInfo.SPathID)

	var targetPath string
	if taskInfo.TPathID != "" {
		targetPath = a.getMountPath(input.JobRunID, taskInfo.TPathID)
	} else if cfg.DestinationFileServer != nil {
		targetPath = a.getMountPath(input.JobRunID, cfg.DestinationFileServer.PathID)
	}

	errorType := types.ErrorTypeTransient

	concurrency := a.Config.MaxCommandConcurrency
	if concurrency <= 0 {
		concurrency = 100
	}

	commands := taskInfo.Commands
	if len(commands) == 0 {
		taskInfo.Status = types.TaskStatusCompleted
		_ = jobContext.PublishToTaskStream(ctx, *taskInfo)
		_ = jobContext.DeleteTask(ctx, input.TaskID)
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
		for i, cmd := range slice {
			wg.Add(1)
			go func(c types.Cmd, cmdIdx int) {
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
					// Mark command as ERROR in taskInfo for status reporting.
					taskInfo.Commands[start+cmdIdx].Status = types.CommandStatusError
					return
				}

				if result != nil {
					atomic.AddInt64(&totalSourceErrors, int64(len(result.SourceErrors)))
					atomic.AddInt64(&totalTargetErrors, int64(len(result.TargetErrors)))
					if len(result.SourceErrors) > 0 || len(result.TargetErrors) > 0 {
						taskInfo.Commands[start+cmdIdx].Status = types.CommandStatusError
					} else {
						taskInfo.Commands[start+cmdIdx].Status = types.CommandStatusCompleted
					}
				} else {
					taskInfo.Commands[start+cmdIdx].Status = types.CommandStatusCompleted
				}
			}(cmd, i)
		}
		wg.Wait()
	}

	// --- Update and report task status (matches TS updateAndReportTaskStatus) ---
	srcErrs := int(totalSourceErrors)
	tgtErrs := int(totalTargetErrors)

	if srcErrs == 0 && tgtErrs == 0 {
		taskInfo.Status = types.TaskStatusCompleted
	} else {
		taskInfo.Status = types.TaskStatusErrored
		taskInfo.RetryCount++
	}

	// Publish final status to TaskStream for db-writer / progress tracking.
	_ = jobContext.PublishToTaskStream(ctx, *taskInfo)

	// Delete the task from TaskMap (completed or errored, matches TS behavior).
	_ = jobContext.DeleteTask(ctx, input.TaskID)

	output := &SyncOutput{
		SourceErrors: srcErrs,
		TargetErrors: tgtErrs,
		Status:       taskInfo.Status,
	}

	a.Logger.Info("SyncTaskActivity completed",
		zap.String("jobRunId", input.JobRunID),
		zap.String("taskId", input.TaskID),
		zap.String("status", taskInfo.Status),
		zap.Int("sourceErrors", output.SourceErrors),
		zap.Int("targetErrors", output.TargetErrors),
	)

	return output, nil
}
