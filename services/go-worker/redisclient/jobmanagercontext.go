package redisclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/logger"
	"github.com/netapp/ndm/services/go-worker/types"
)

// JobManagerContext manages the Redis-backed state for scan/sync workflows.
// It maps to the TypeScript RedisJobManagerContext from jobs-lib and provides
// typed stream collections and hash map collections for coordinating work
// between the job manager and workers.
type JobManagerContext struct {
	JobRunID     string           `json:"jobRunId"`
	JobConfig    *types.JobConfig `json:"jobConfig,omitempty"`
	JobRunStatus string           `json:"jobRunStatus,omitempty"`

	rdb    *redis.Client
	logger *logger.Logger

	// Stream collections.
	FileStream    *StreamCollection[types.ItemInfo]  `json:"-"`
	ErrorStream   *StreamCollection[types.DMError]   `json:"-"`
	CommandStream *StreamCollection[types.Cmd]       `json:"-"`
	TaskStream    *StreamCollection[types.TaskInfo]  `json:"-"`

	// Hash map collections.
	TaskMap     *HMapCollection `json:"-"`
	DirBatchMap *HMapCollection `json:"-"`
}

// NewJobManagerContext creates a new JobManagerContext with all stream and hash
// map collections initialized for the given job run ID. Stream keys follow the
// pattern "{jobRunId}:{type}" as defined in the TypeScript jobs-lib.
func NewJobManagerContext(rdb *redis.Client, jobRunID string, jobConfig *types.JobConfig, log *logger.Logger) *JobManagerContext {
	return &JobManagerContext{
		JobRunID:  jobRunID,
		JobConfig: jobConfig,
		rdb:       rdb,
		logger:    log,

		FileStream:    NewStreamCollection[types.ItemInfo](rdb, fmt.Sprintf("%s:files", jobRunID), log),
		ErrorStream:   NewStreamCollection[types.DMError](rdb, fmt.Sprintf("%s:errors", jobRunID), log),
		CommandStream: NewStreamCollection[types.Cmd](rdb, fmt.Sprintf("%s:commands", jobRunID), log),
		TaskStream:    NewStreamCollection[types.TaskInfo](rdb, fmt.Sprintf("%s:tasks", jobRunID), log),

		TaskMap:     NewHMapCollection(rdb, fmt.Sprintf("%s:taskMap", jobRunID), log),
		DirBatchMap: NewHMapCollection(rdb, fmt.Sprintf("%s:dirBatchMap", jobRunID), log),
	}
}

// Init creates consumer groups for all stream collections and persists the
// serialized context state in Redis.
func (jmc *JobManagerContext) Init(ctx context.Context) error {
	jmc.logger.Info("Initializing job manager context", zap.String("jobRunId", jmc.JobRunID))

	streams := []struct {
		name string
		init func() error
	}{
		{"fileStream", func() error { return jmc.FileStream.Init(jmc.JobRunID) }},
		{"errorStream", func() error { return jmc.ErrorStream.Init(jmc.JobRunID) }},
		{"commandStream", func() error { return jmc.CommandStream.Init(jmc.JobRunID) }},
		{"taskStream", func() error { return jmc.TaskStream.Init(jmc.JobRunID) }},
	}

	for _, s := range streams {
		if err := s.init(); err != nil {
			return fmt.Errorf("initializing %s: %w", s.name, err)
		}
	}

	// Persist the serialized context.
	data, err := jmc.serialize()
	if err != nil {
		return fmt.Errorf("serializing job manager context: %w", err)
	}
	if err := jmc.rdb.Set(ctx, jmc.JobRunID, string(data), 0).Err(); err != nil {
		return fmt.Errorf("storing job manager context in Redis: %w", err)
	}

	return nil
}

// --- Stream publish operations ---

// PublishToFileStream appends a single ItemInfo to the file stream.
func (jmc *JobManagerContext) PublishToFileStream(ctx context.Context, item types.ItemInfo) error {
	return jmc.FileStream.Append(ctx, item)
}

// PublishToFileStreamBulk appends multiple ItemInfo records to the file stream
// using a pipeline for improved throughput.
func (jmc *JobManagerContext) PublishToFileStreamBulk(ctx context.Context, items []types.ItemInfo) error {
	return jmc.FileStream.AppendBulk(ctx, items)
}

// PublishToErrorStream appends a single DMError to the error stream.
func (jmc *JobManagerContext) PublishToErrorStream(ctx context.Context, dmErr types.DMError) error {
	return jmc.ErrorStream.Append(ctx, dmErr)
}

// PublishToCommandStream appends a single Cmd to the command stream.
func (jmc *JobManagerContext) PublishToCommandStream(ctx context.Context, cmd types.Cmd) error {
	return jmc.CommandStream.Append(ctx, cmd)
}

// PublishBulkToCommandStream appends multiple Cmd records to the command stream
// using a pipeline.
func (jmc *JobManagerContext) PublishBulkToCommandStream(ctx context.Context, cmds []types.Cmd) error {
	return jmc.CommandStream.AppendBulk(ctx, cmds)
}

// PublishToTaskStream appends a single TaskInfo to the task stream.
func (jmc *JobManagerContext) PublishToTaskStream(ctx context.Context, task types.TaskInfo) error {
	return jmc.TaskStream.Append(ctx, task)
}

// --- Group read operations ---

// GroupReadCommandStream reads messages from the command stream consumer group.
// Uses the "worker" group type for command consumption.
func (jmc *JobManagerContext) GroupReadCommandStream(ctx context.Context, consumerName string, batchSize int64) ([]StreamMessage[types.Cmd], error) {
	return jmc.CommandStream.GroupRead(ctx, jmc.JobRunID, "worker", consumerName, batchSize)
}

// GroupAckCommandStream acknowledges processed command stream messages.
func (jmc *JobManagerContext) GroupAckCommandStream(ctx context.Context, ids ...string) error {
	return jmc.CommandStream.GroupAck(ctx, jmc.JobRunID, "worker", ids...)
}

// GroupReadFileStream reads messages from the file stream consumer group.
// Uses the "worker" group type for file consumption.
func (jmc *JobManagerContext) GroupReadFileStream(ctx context.Context, consumerName string, batchSize int64) ([]StreamMessage[types.ItemInfo], error) {
	return jmc.FileStream.GroupRead(ctx, jmc.JobRunID, "worker", consumerName, batchSize)
}

// --- Task map operations ---

// SetTask stores a TaskInfo in the task hash map keyed by taskID.
func (jmc *JobManagerContext) SetTask(ctx context.Context, taskID string, task types.TaskInfo) error {
	return jmc.TaskMap.SetValue(ctx, taskID, task)
}

// GetTask retrieves a TaskInfo from the task hash map by taskID. Returns nil
// if the task does not exist.
func (jmc *JobManagerContext) GetTask(ctx context.Context, taskID string) (*types.TaskInfo, error) {
	var task types.TaskInfo
	err := jmc.TaskMap.GetValue(ctx, taskID, &task)
	if err != nil {
		// Check if the error wraps redis.Nil (not found).
		if isRedisNilError(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("getting task %s: %w", taskID, err)
	}
	return &task, nil
}

// DeleteTask removes a task from the task hash map by taskID.
func (jmc *JobManagerContext) DeleteTask(ctx context.Context, taskID string) error {
	return jmc.TaskMap.DeleteValue(ctx, taskID)
}

// SetTaskIfNotExists stores a TaskInfo in the task hash map only if the taskID
// does not already exist. Returns true if the task was set, false if it already
// existed.
func (jmc *JobManagerContext) SetTaskIfNotExists(ctx context.Context, taskID string, task types.TaskInfo) (bool, error) {
	return jmc.TaskMap.SetValueIfNotExists(ctx, taskID, task)
}

// --- Dir batch map operations ---

// SetBatchDir stores a list of directory paths in the dir batch hash map keyed
// by batchID.
func (jmc *JobManagerContext) SetBatchDir(ctx context.Context, batchID string, dirs []string) error {
	return jmc.DirBatchMap.SetValue(ctx, batchID, dirs)
}

// GetBatchDir retrieves a list of directory paths from the dir batch hash map
// by batchID. Returns nil if the batch does not exist.
func (jmc *JobManagerContext) GetBatchDir(ctx context.Context, batchID string) ([]string, error) {
	var dirs []string
	err := jmc.DirBatchMap.GetValue(ctx, batchID, &dirs)
	if err != nil {
		if isRedisNilError(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("getting batch dir %s: %w", batchID, err)
	}
	return dirs, nil
}

// DeleteBatchDir removes a batch of directories from the dir batch hash map by
// batchID.
func (jmc *JobManagerContext) DeleteBatchDir(ctx context.Context, batchID string) error {
	return jmc.DirBatchMap.DeleteValue(ctx, batchID)
}

// --- Command stream length ---

// GetCommandStreamLength returns the number of messages currently in the
// command stream.
func (jmc *JobManagerContext) GetCommandStreamLength(ctx context.Context) (int64, error) {
	return jmc.CommandStream.GetLength(ctx)
}

// --- Lifecycle ---

// Cleanup destroys all stream consumer groups, deletes all streams, and removes
// all Redis keys associated with this job run.
func (jmc *JobManagerContext) Cleanup(ctx context.Context) error {
	jmc.logger.Info("Cleaning up job manager context", zap.String("jobRunId", jmc.JobRunID))

	// Cleanup stream consumer groups and delete streams.
	streamCleanups := []struct {
		name    string
		cleanup func() error
	}{
		{"fileStream", func() error { return jmc.FileStream.Cleanup(jmc.JobRunID) }},
		{"errorStream", func() error { return jmc.ErrorStream.Cleanup(jmc.JobRunID) }},
		{"commandStream", func() error { return jmc.CommandStream.Cleanup(jmc.JobRunID) }},
		{"taskStream", func() error { return jmc.TaskStream.Cleanup(jmc.JobRunID) }},
	}

	for _, sc := range streamCleanups {
		if err := sc.cleanup(); err != nil {
			jmc.logger.Warn("Error cleaning up stream",
				zap.String("stream", sc.name),
				zap.Error(err))
		}
	}

	// Delete hash map keys.
	if err := jmc.TaskMap.DeleteAll(ctx); err != nil {
		jmc.logger.Warn("Error deleting task map", zap.Error(err))
	}
	if err := jmc.DirBatchMap.DeleteAll(ctx); err != nil {
		jmc.logger.Warn("Error deleting dir batch map", zap.Error(err))
	}

	// Delete all keys matching the job run ID pattern.
	exists, err := jmc.rdb.Exists(ctx, jmc.JobRunID).Result()
	if err != nil {
		return fmt.Errorf("checking existence of job run key: %w", err)
	}
	if exists > 0 {
		var cursor uint64
		pattern := fmt.Sprintf("%s*", jmc.JobRunID)
		for {
			var keys []string
			keys, cursor, err = jmc.rdb.Scan(ctx, cursor, pattern, 100).Result()
			if err != nil {
				return fmt.Errorf("scanning keys for pattern %s: %w", pattern, err)
			}
			for _, key := range keys {
				if delErr := jmc.rdb.Del(ctx, key).Err(); delErr != nil {
					jmc.logger.Warn("Error deleting key",
						zap.String("key", key),
						zap.Error(delErr))
				}
			}
			if cursor == 0 {
				break
			}
		}
	}

	return nil
}

// Close persists the current context state to Redis. Unlike Cleanup, Close does
// not destroy consumer groups or delete streams.
func (jmc *JobManagerContext) Close(ctx context.Context) error {
	jmc.logger.Info("Closing job manager context", zap.String("jobRunId", jmc.JobRunID))

	data, err := jmc.serialize()
	if err != nil {
		return fmt.Errorf("serializing job manager context on close: %w", err)
	}
	if err := jmc.rdb.Set(ctx, jmc.JobRunID, string(data), 0).Err(); err != nil {
		return fmt.Errorf("persisting job manager context on close: %w", err)
	}
	return nil
}

// serialize produces the JSON representation of the job manager context state.
func (jmc *JobManagerContext) serialize() ([]byte, error) {
	payload := map[string]interface{}{
		"jobRunId":     jmc.JobRunID,
		"jobConfig":    jmc.JobConfig,
		"jobRunStatus": jmc.JobRunStatus,
	}
	return json.Marshal(payload)
}

// isRedisNilError checks whether an error chain contains a redis.Nil sentinel,
// indicating a key or field was not found. It uses errors.Is to walk the full
// error chain produced by fmt.Errorf %w wrapping.
func isRedisNilError(err error) bool {
	return errors.Is(err, redis.Nil)
}
