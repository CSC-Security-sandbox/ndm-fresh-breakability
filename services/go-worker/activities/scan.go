package activities

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"go.temporal.io/sdk/activity"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/redisclient"
	"github.com/netapp/ndm/services/go-worker/types"
)

// ScanInput contains the parameters for the ScanDirectories activity.
type ScanInput struct {
	JobRunID    string `json:"jobRunId"`
	BatchID     string `json:"batchId"`
	BatchSize   int    `json:"batchSize"`
	IsMigration bool   `json:"isMigration"`
}

// ScanOutput contains the results of the ScanDirectories activity.
type ScanOutput struct {
	FileCount int      `json:"fileCount"`
	DirCount  int      `json:"dirCount"`
	BatchDirs []string `json:"batchDirs"`
	Error     string   `json:"error,omitempty"`
}

// ScanDirectoryOutput holds the results of scanning a single directory.
type ScanDirectoryOutput struct {
	FileCount int      `json:"fileCount"`
	DirCount  int      `json:"dirCount"`
	SubDirs   []string `json:"subDirs"`
}

// ScanDirectories reads a batch of directories from Redis and scans each one,
// accumulating file and directory counts and discovering new subdirectories.
// It records heartbeats every 2 seconds to signal liveness to Temporal.
func (a *Activities) ScanDirectories(ctx context.Context, input ScanInput) (*ScanOutput, error) {
	a.Logger.Info("ScanDirectories started",
		zap.String("jobRunId", input.JobRunID),
		zap.String("batchId", input.BatchID),
		zap.Int("batchSize", input.BatchSize),
		zap.Bool("isMigration", input.IsMigration),
	)

	jobContext, err := a.getJobManagerContext(ctx, input.JobRunID)
	if err != nil {
		return nil, fmt.Errorf("getting job manager context: %w", err)
	}

	// Read the batch of directories to scan.
	dirs, err := jobContext.GetBatchDir(ctx, input.BatchID)
	if err != nil {
		return nil, fmt.Errorf("getting batch dir %s: %w", input.BatchID, err)
	}
	if dirs == nil {
		return &ScanOutput{Error: "batch not found"}, nil
	}

	// Delete the batch once read.
	if err := jobContext.DeleteBatchDir(ctx, input.BatchID); err != nil {
		a.Logger.Warn("failed to delete batch dir", zap.String("batchId", input.BatchID), zap.Error(err))
	}

	cfg := jobContext.JobConfig
	if cfg == nil {
		return nil, fmt.Errorf("job config not found for %s", input.JobRunID)
	}

	// Resolve paths.
	sourcePrefix := a.getMountPath(input.JobRunID, cfg.SourceFileServer.PathID)
	sourcePath := filepath.Join(sourcePrefix, cfg.SourcePath)

	var targetPrefix, targetPath string
	if cfg.DestinationFileServer != nil {
		targetPrefix = a.getMountPath(input.JobRunID, cfg.DestinationFileServer.PathID)
		targetPath = filepath.Join(targetPrefix, cfg.DestinationPath)
	}

	// Resolve exclusion options.
	var excludePatterns, skipFile string
	var olderThan time.Time
	if cfg.Options != nil {
		excludePatterns = cfg.Options.ExcludeFilePattern
		skipFile = cfg.Options.SkipsFilesModifiedInLast
		if cfg.Options.ExcludeOlderThan != "" {
			olderThan, _ = time.Parse(time.RFC3339, cfg.Options.ExcludeOlderThan)
		}
	}

	// Determine error type based on protocol.
	errorType := types.ErrorTypeTransient

	output := &ScanOutput{
		BatchDirs: make([]string, 0),
	}

	// Heartbeat ticker.
	heartbeatTicker := time.NewTicker(2 * time.Second)
	defer heartbeatTicker.Stop()

	for i, dir := range dirs {
		// Check for cancellation.
		select {
		case <-ctx.Done():
			return output, ctx.Err()
		default:
		}

		// Record heartbeat periodically.
		select {
		case <-heartbeatTicker.C:
			activity.RecordHeartbeat(ctx, fmt.Sprintf("scanning dir %d/%d", i+1, len(dirs)))
		default:
		}

		fullSourceDir := filepath.Join(sourcePath, dir)
		cmd := types.Cmd{
			FPath: dir,
			IsDir: true,
		}

		var scanResult *ScanDirectoryOutput
		if input.IsMigration {
			fullTargetDir := filepath.Join(targetPath, dir)
			scanResult, err = a.MigrateScanDirectory(
				jobContext,
				fullSourceDir, sourcePrefix,
				fullTargetDir, targetPrefix,
				cmd,
				excludePatterns,
				skipFile,
				olderThan,
				errorType,
			)
		} else {
			scanResult, err = a.DiscoveryScanDirectory(
				jobContext,
				fullSourceDir, sourcePrefix,
				cmd,
				excludePatterns,
				skipFile,
				olderThan,
				errorType,
			)
		}

		if err != nil {
			a.Logger.Error("scan directory failed",
				zap.String("dir", dir),
				zap.Error(err),
			)
			// Publish error to the error stream.
			dmErr := NewDMError(
				"SCAN_DIR_ERROR",
				types.OriginSource,
				types.OperationReadDir,
				errorType,
				cmd.ID,
				err,
				types.ErroredFile{FileName: filepath.Base(dir), FilePath: dir},
			)
			if pubErr := jobContext.PublishToErrorStream(ctx, dmErr); pubErr != nil {
				a.Logger.Error("failed to publish scan error", zap.Error(pubErr))
			}
			continue
		}

		if scanResult != nil {
			output.FileCount += scanResult.FileCount
			output.DirCount += scanResult.DirCount
			output.BatchDirs = append(output.BatchDirs, scanResult.SubDirs...)
		}
	}

	a.Logger.Info("ScanDirectories completed",
		zap.String("jobRunId", input.JobRunID),
		zap.Int("fileCount", output.FileCount),
		zap.Int("dirCount", output.DirCount),
		zap.Int("subDirs", len(output.BatchDirs)),
	)

	return output, nil
}

// getJobManagerContext retrieves the JobManagerContext from Redis for the
// given job run ID.
func (a *Activities) getJobManagerContext(ctx context.Context, jobRunID string) (*redisclient.JobManagerContext, error) {
	rdb := a.Redis.Client()

	// Fetch the serialized context from Redis.
	val, err := rdb.Get(ctx, jobRunID).Result()
	if err != nil {
		return nil, fmt.Errorf("fetching job context from Redis for %s: %w", jobRunID, err)
	}

	// Parse the job config from the stored context.
	var storedCtx struct {
		JobConfig    *types.JobConfig `json:"jobConfig"`
		JobRunStatus string           `json:"jobRunStatus"`
	}
	if err := parseJSON([]byte(val), &storedCtx); err != nil {
		return nil, fmt.Errorf("parsing stored job context: %w", err)
	}

	jmc := redisclient.NewJobManagerContext(rdb, jobRunID, storedCtx.JobConfig, a.Logger)
	jmc.JobRunStatus = storedCtx.JobRunStatus
	return jmc, nil
}

// getMountPath returns the local mount path for a given path ID.
func (a *Activities) getMountPath(jobRunID, pathID string) string {
	return filepath.Join(a.Config.BaseWorkingPath, jobRunID, pathID)
}
