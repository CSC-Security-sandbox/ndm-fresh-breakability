package redisclient

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/logger"
	"github.com/netapp/ndm/services/go-worker/types"
)

// JobContext wraps Redis-backed job state, providing access to multiple typed
// stream collections and hash maps. This maps to RedisJobContext from the
// TypeScript jobs-lib.
type JobContext struct {
	JobRunID  string           `json:"jobRunId"`
	JobConfig *types.JobConfig `json:"jobConfig,omitempty"`
	JobState  *types.JobState  `json:"jobState,omitempty"`

	rdb    *redis.Client
	logger *logger.Logger

	// Stream collections for various data types.
	FilesInfo   *StreamCollection[types.FileInfo]  `json:"-"`
	DirsInfo    *StreamCollection[types.FileInfo]  `json:"-"`
	TasksInfo   *StreamCollection[types.TaskInfo]  `json:"-"`
	ErrorsInfo  *StreamCollection[types.DMError]   `json:"-"`
	MigrateTask *StreamCollection[types.TaskInfo]  `json:"-"`
	TaskStats   *StreamCollection[types.TaskStats] `json:"-"`
}

// NewJobContext creates a new JobContext with all stream collections
// initialized for the given job run ID. The stream keys follow the pattern
// "{jobRunId}:{streamType}".
func NewJobContext(rdb *redis.Client, jobRunID string, log *logger.Logger) *JobContext {
	return &JobContext{
		JobRunID: jobRunID,
		rdb:      rdb,
		logger:   log,

		FilesInfo:   NewStreamCollection[types.FileInfo](rdb, fmt.Sprintf("%s:files", jobRunID), log),
		DirsInfo:    NewStreamCollection[types.FileInfo](rdb, fmt.Sprintf("%s:dirs", jobRunID), log),
		TasksInfo:   NewStreamCollection[types.TaskInfo](rdb, fmt.Sprintf("%s:tasks", jobRunID), log),
		ErrorsInfo:  NewStreamCollection[types.DMError](rdb, fmt.Sprintf("%s:errors", jobRunID), log),
		MigrateTask: NewStreamCollection[types.TaskInfo](rdb, fmt.Sprintf("%s:migration-tasks", jobRunID), log),
		TaskStats:   NewStreamCollection[types.TaskStats](rdb, fmt.Sprintf("%s:tasks-stats", jobRunID), log),
	}
}

// Init initializes all stream collections by creating their consumer groups
// and stores the serialized job context in Redis under the jobRunID key. Any
// pre-existing keys for this job run are cleaned up first.
func (jc *JobContext) Init(ctx context.Context) error {
	jc.logger.Info("Initializing job context", zap.String("jobRunId", jc.JobRunID))

	// Clean up any pre-existing keys.
	for _, key := range []string{jc.JobRunID, fmt.Sprintf("stats:%s", jc.JobRunID)} {
		exists, err := jc.rdb.Exists(ctx, key).Result()
		if err != nil {
			return fmt.Errorf("checking existence of key %s: %w", key, err)
		}
		if exists > 0 {
			jc.logger.Info("Cleaning up existing key", zap.String("key", key))
			if err := jc.rdb.Del(ctx, key).Err(); err != nil {
				return fmt.Errorf("deleting existing key %s: %w", key, err)
			}
		}
	}

	// Initialize all stream collections.
	streams := []*streamInitEntry{
		{name: "filesInfo", init: func() error { return jc.FilesInfo.Init(jc.JobRunID) }},
		{name: "dirsInfo", init: func() error { return jc.DirsInfo.Init(jc.JobRunID) }},
		{name: "tasksInfo", init: func() error { return jc.TasksInfo.Init(jc.JobRunID) }},
		{name: "errorsInfo", init: func() error { return jc.ErrorsInfo.Init(jc.JobRunID) }},
		{name: "migrateTask", init: func() error { return jc.MigrateTask.Init(jc.JobRunID) }},
		{name: "taskStats", init: func() error { return jc.TaskStats.Init(jc.JobRunID) }},
	}

	for _, s := range streams {
		if err := s.init(); err != nil {
			return fmt.Errorf("initializing %s stream: %w", s.name, err)
		}
	}

	// Persist the serialized context.
	data, err := jc.Serialize()
	if err != nil {
		return fmt.Errorf("serializing job context: %w", err)
	}
	if err := jc.rdb.Set(ctx, jc.JobRunID, string(data), 0).Err(); err != nil {
		return fmt.Errorf("storing job context in Redis: %w", err)
	}

	return nil
}

// Close persists the current job context state to Redis and logs the closure.
func (jc *JobContext) Close(ctx context.Context) error {
	jc.logger.Info("Closing job context", zap.String("jobRunId", jc.JobRunID))

	data, err := jc.Serialize()
	if err != nil {
		return fmt.Errorf("serializing job context on close: %w", err)
	}
	if err := jc.rdb.Set(ctx, jc.JobRunID, string(data), 0).Err(); err != nil {
		return fmt.Errorf("persisting job context on close: %w", err)
	}

	return nil
}

// Cleanup removes all Redis keys and stream consumer groups associated with
// this job run.
func (jc *JobContext) Cleanup(ctx context.Context) error {
	jc.logger.Info("Cleaning up job context", zap.String("jobRunId", jc.JobRunID))

	// Delete all keys matching the job run ID pattern.
	exists, err := jc.rdb.Exists(ctx, jc.JobRunID).Result()
	if err != nil {
		return fmt.Errorf("checking existence of job run key: %w", err)
	}
	if exists > 0 {
		// Use SCAN to find keys matching the pattern (safer than KEYS in production).
		var cursor uint64
		pattern := fmt.Sprintf("%s*", jc.JobRunID)
		for {
			var keys []string
			keys, cursor, err = jc.rdb.Scan(ctx, cursor, pattern, 100).Result()
			if err != nil {
				return fmt.Errorf("scanning keys for pattern %s: %w", pattern, err)
			}
			for _, key := range keys {
				jc.logger.Debug("Deleting key", zap.String("key", key))
				if err := jc.rdb.Del(ctx, key).Err(); err != nil {
					return fmt.Errorf("deleting key %s: %w", key, err)
				}
			}
			if cursor == 0 {
				break
			}
		}
	}

	// Cleanup all stream consumer groups.
	collections := []struct {
		name   string
		stream interface{ Cleanup(string) error }
	}{
		{"filesInfo", jc.FilesInfo},
		{"dirsInfo", jc.DirsInfo},
		{"errorsInfo", jc.ErrorsInfo},
	}

	for _, c := range collections {
		if err := c.stream.Cleanup(jc.JobRunID); err != nil {
			jc.logger.Warn("Error cleaning up stream",
				zap.String("stream", c.name),
				zap.Error(err))
		}
	}

	return nil
}

// Serialize returns the JSON representation of the job context's state,
// matching the TypeScript serialize() method.
func (jc *JobContext) Serialize() ([]byte, error) {
	payload := map[string]interface{}{
		"jobRunId":  jc.JobRunID,
		"jobConfig": jc.JobConfig,
		"jobState":  jc.JobState,
	}
	return json.Marshal(payload)
}

// Deserialize populates the job context from a JSON byte slice previously
// produced by Serialize.
func (jc *JobContext) Deserialize(data []byte) error {
	var payload struct {
		JobRunID  string           `json:"jobRunId"`
		JobConfig *types.JobConfig `json:"jobConfig"`
		JobState  *types.JobState  `json:"jobState"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return fmt.Errorf("deserializing job context: %w", err)
	}
	jc.JobRunID = payload.JobRunID
	jc.JobConfig = payload.JobConfig
	jc.JobState = payload.JobState
	return nil
}

// streamInitEntry is a helper type used to iterate over streams during
// initialization.
type streamInitEntry struct {
	name string
	init func() error
}
