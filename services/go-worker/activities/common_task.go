package activities

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	enumspb "go.temporal.io/api/enums/v1"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/types"
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

// GetGroupOfTasks reads a batch of commands from the Redis command stream,
// groups them into tasks of CommandsInTask size, computes a SHA256 hash of each
// group's command IDs, stores the TaskInfo in the TaskMap via
// SetTaskIfNotExists, and returns the list of hash keys.
//
// This matches the TypeScript common-task.service.ts getGroupOfTasksActivity():
//  1. Read up to RedisStreamGroupSize commands from the command stream
//  2. Group commands into chunks of CommandsInTask
//  3. For each chunk: build a TaskInfo, hash command IDs, store in TaskMap
//  4. Acknowledge all consumed stream messages
//  5. Return list of hash keys (task IDs)
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

	groupSize := int64(a.Config.RedisStreamGroupSize)
	if groupSize <= 0 {
		groupSize = 1000
	}
	commandsInTask := a.Config.CommandsInTask
	if commandsInTask <= 0 {
		commandsInTask = 100
	}

	consumerName := fmt.Sprintf("consumer-%s", jobRunID)
	messages, err := jobContext.GroupReadCommandStream(ctx, consumerName, groupSize)
	if err != nil {
		return nil, fmt.Errorf("reading command stream: %w", err)
	}

	cfg := jobContext.JobConfig

	var taskIDs []string
	var commands []types.Cmd
	var streamIDs []string

	for _, msg := range messages {
		commands = append(commands, msg.Data)
		streamIDs = append(streamIDs, msg.ID)

		if len(commands) >= commandsInTask {
			hashKey := calculateCommandHash(commands)
			task := buildTask(types.TaskTypeMigrate, jobRunID, cfg, commands)
			if _, err := jobContext.SetTaskIfNotExists(ctx, hashKey, task); err != nil {
				a.Logger.Error("failed to store task in TaskMap",
					zap.String("hash", hashKey),
					zap.Error(err))
			}
			taskIDs = append(taskIDs, hashKey)
			commands = nil
		}
	}

	// Flush remaining commands that didn't fill a full chunk.
	if len(commands) > 0 {
		hashKey := calculateCommandHash(commands)
		task := buildTask(types.TaskTypeMigrate, jobRunID, cfg, commands)
		if _, err := jobContext.SetTaskIfNotExists(ctx, hashKey, task); err != nil {
			a.Logger.Error("failed to store task in TaskMap",
				zap.String("hash", hashKey),
				zap.Error(err))
		}
		taskIDs = append(taskIDs, hashKey)
	}

	// Acknowledge all consumed stream messages.
	if len(streamIDs) > 0 {
		if err := jobContext.GroupAckCommandStream(ctx, streamIDs...); err != nil {
			a.Logger.Error("failed to acknowledge command stream messages",
				zap.Error(err),
			)
		}
	}

	a.Logger.Info("GetGroupOfTasks completed",
		zap.String("jobRunId", jobRunID),
		zap.Int("taskCount", len(taskIDs)),
		zap.Int("commandsConsumed", len(streamIDs)),
	)

	return taskIDs, nil
}

// calculateCommandHash computes a deterministic SHA256 hash from a list of
// command IDs. The IDs are sorted, joined with commas, and hashed. This matches
// the TypeScript calculateCommandHash in utils.ts.
func calculateCommandHash(commands []types.Cmd) string {
	ids := make([]string, len(commands))
	for i, cmd := range commands {
		ids[i] = cmd.ID
	}
	sort.Strings(ids)
	concatenated := strings.Join(ids, ",")
	hash := sha256.Sum256([]byte(concatenated))
	return hex.EncodeToString(hash[:])
}

// buildTask constructs a TaskInfo from a task type, job run ID, job config, and
// a slice of commands. This matches the TypeScript buildTask in utils.ts.
func buildTask(taskType string, jobRunID string, cfg *types.JobConfig, commands []types.Cmd) types.TaskInfo {
	var sPathID string
	if cfg != nil {
		sPathID = cfg.SourceFileServer.PathID
	}
	var tPathID string
	if cfg != nil && cfg.DestinationFileServer != nil {
		tPathID = cfg.DestinationFileServer.PathID
	}

	// Make a copy of commands to avoid sharing the underlying slice.
	cmdsCopy := make([]types.Cmd, len(commands))
	copy(cmdsCopy, commands)

	return types.TaskInfo{
		ID:       uuid.New().String(),
		JobRunID: jobRunID,
		TaskType: taskType,
		Status:   types.TaskStatusPending,
		WorkerID: "",
		SPathID:  sPathID,
		TPathID:  tPathID,
		Commands: cmdsCopy,
	}
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
