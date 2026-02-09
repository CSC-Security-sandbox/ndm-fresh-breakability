package activities

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/protocols"
	"github.com/netapp/ndm/services/go-worker/types"
)

// SpeedTestSetupInput contains the parameters for SpeedTestSetup.
type SpeedTestSetupInput struct {
	JobRunID  string                  `json:"jobRunId"`
	JobConfig *types.JobConfig        `json:"jobConfig"`
}

// SpeedTestCleanupInput contains the parameters for SpeedTestCleanup.
type SpeedTestCleanupInput struct {
	JobRunID  string                  `json:"jobRunId"`
	JobConfig *types.JobConfig        `json:"jobConfig"`
}

// SetupWorker mounts the source and target paths using the appropriate protocol
// (SMB or NFS) based on the job configuration stored in Redis.
func (a *Activities) SetupWorker(ctx context.Context, jobRunID string) error {
	a.Logger.Info("SetupWorker started", zap.String("jobRunId", jobRunID))

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		return fmt.Errorf("getting job manager context: %w", err)
	}

	cfg := jobContext.JobConfig
	if cfg == nil {
		return fmt.Errorf("job config not found for %s", jobRunID)
	}

	// Mount source path.
	if err := a.mountFileServer(jobRunID, cfg.SourceFileServer); err != nil {
		return fmt.Errorf("mounting source path: %w", err)
	}

	// Mount destination path if present.
	if cfg.DestinationFileServer != nil {
		if err := a.mountFileServer(jobRunID, *cfg.DestinationFileServer); err != nil {
			return fmt.Errorf("mounting destination path: %w", err)
		}
	}

	a.Logger.Info("SetupWorker completed", zap.String("jobRunId", jobRunID))
	return nil
}

// CleanupWorker unmounts and removes mount directories for both source and
// target paths.
func (a *Activities) CleanupWorker(ctx context.Context, jobRunID string) error {
	a.Logger.Info("CleanupWorker started", zap.String("jobRunId", jobRunID))

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		a.Logger.Warn("failed to get job context for cleanup",
			zap.String("jobRunId", jobRunID),
			zap.Error(err),
		)
		// Still try to clean up the mount directory.
		jobRunDir := filepath.Join(a.Config.BaseWorkingPath, jobRunID)
		if removeErr := os.RemoveAll(jobRunDir); removeErr != nil {
			a.Logger.Warn("failed to remove job run directory",
				zap.String("dir", jobRunDir),
				zap.Error(removeErr),
			)
		}
		return nil
	}

	cfg := jobContext.JobConfig
	if cfg == nil {
		a.Logger.Warn("job config not found for cleanup", zap.String("jobRunId", jobRunID))
		return nil
	}

	// Unmount source path.
	if err := a.unmountFileServer(jobRunID, cfg.SourceFileServer); err != nil {
		a.Logger.Error("failed to unmount source path",
			zap.String("jobRunId", jobRunID),
			zap.Error(err),
		)
	}

	// Unmount destination path if present.
	if cfg.DestinationFileServer != nil {
		if err := a.unmountFileServer(jobRunID, *cfg.DestinationFileServer); err != nil {
			a.Logger.Error("failed to unmount destination path",
				zap.String("jobRunId", jobRunID),
				zap.Error(err),
			)
		}
	}

	// Clean up the job run mount directory.
	jobRunDir := filepath.Join(a.Config.BaseWorkingPath, jobRunID)
	if err := os.RemoveAll(jobRunDir); err != nil {
		a.Logger.Warn("failed to remove job run directory",
			zap.String("dir", jobRunDir),
			zap.Error(err),
		)
	}

	a.Logger.Info("CleanupWorker completed", zap.String("jobRunId", jobRunID))
	return nil
}

// SpeedTestSetup mounts file server paths needed for speed testing.
func (a *Activities) SpeedTestSetup(ctx context.Context, input SpeedTestSetupInput) error {
	a.Logger.Info("SpeedTestSetup started", zap.String("jobRunId", input.JobRunID))

	cfg := input.JobConfig
	if cfg == nil {
		return fmt.Errorf("job config is nil for speed test setup")
	}

	// Mount source path.
	if err := a.mountFileServer(input.JobRunID, cfg.SourceFileServer); err != nil {
		return fmt.Errorf("mounting source path for speed test: %w", err)
	}

	// Mount destination path if present.
	if cfg.DestinationFileServer != nil {
		if err := a.mountFileServer(input.JobRunID, *cfg.DestinationFileServer); err != nil {
			return fmt.Errorf("mounting destination path for speed test: %w", err)
		}
	}

	a.Logger.Info("SpeedTestSetup completed", zap.String("jobRunId", input.JobRunID))
	return nil
}

// SpeedTestCleanup unmounts file server paths after speed testing.
func (a *Activities) SpeedTestCleanup(ctx context.Context, input SpeedTestCleanupInput) error {
	a.Logger.Info("SpeedTestCleanup started", zap.String("jobRunId", input.JobRunID))

	cfg := input.JobConfig
	if cfg == nil {
		a.Logger.Warn("job config is nil for speed test cleanup", zap.String("jobRunId", input.JobRunID))
		return nil
	}

	// Unmount source path.
	if err := a.unmountFileServer(input.JobRunID, cfg.SourceFileServer); err != nil {
		a.Logger.Error("failed to unmount source path for speed test",
			zap.String("jobRunId", input.JobRunID),
			zap.Error(err),
		)
	}

	// Unmount destination path if present.
	if cfg.DestinationFileServer != nil {
		if err := a.unmountFileServer(input.JobRunID, *cfg.DestinationFileServer); err != nil {
			a.Logger.Error("failed to unmount destination path for speed test",
				zap.String("jobRunId", input.JobRunID),
				zap.Error(err),
			)
		}
	}

	// Clean up mount directory.
	jobRunDir := filepath.Join(a.Config.BaseWorkingPath, input.JobRunID)
	if err := os.RemoveAll(jobRunDir); err != nil {
		a.Logger.Warn("failed to remove speed test mount directory",
			zap.String("dir", jobRunDir),
			zap.Error(err),
		)
	}

	a.Logger.Info("SpeedTestCleanup completed", zap.String("jobRunId", input.JobRunID))
	return nil
}

// mountFileServer mounts a file server path using the appropriate protocol.
func (a *Activities) mountFileServer(jobRunID string, fs types.FileServerDetails) error {
	protocolType := getProtocolType(fs)
	if protocolType == "" {
		return fmt.Errorf("no protocol type found for file server %s", fs.Hostname)
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		return fmt.Errorf("unsupported protocol type: %s", protocolType)
	}

	payload := protocols.ProtocolPayload{
		Hostname:        fs.Hostname,
		Username:        fs.Username,
		Password:        fs.Password,
		Path:            fs.Path,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        jobRunID,
		PathID:          fs.PathID,
		ProtocolVersion: fs.ProtocolVersion,
		DirPath:         filepath.Join(a.Config.BaseWorkingPath, jobRunID, fs.PathID),
	}

	if err := proto.MountPath(jobRunID, payload, true); err != nil {
		return fmt.Errorf("mounting %s at %s: %w", protocolType, fs.Hostname, err)
	}

	return nil
}

// unmountFileServer unmounts a file server path using the appropriate protocol.
func (a *Activities) unmountFileServer(jobRunID string, fs types.FileServerDetails) error {
	protocolType := getProtocolType(fs)
	if protocolType == "" {
		return fmt.Errorf("no protocol type found for file server %s", fs.Hostname)
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		return fmt.Errorf("unsupported protocol type: %s", protocolType)
	}

	payload := protocols.ProtocolPayload{
		Hostname:        fs.Hostname,
		Username:        fs.Username,
		Password:        fs.Password,
		Path:            fs.Path,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        jobRunID,
		PathID:          fs.PathID,
		ProtocolVersion: fs.ProtocolVersion,
		DirPath:         filepath.Join(a.Config.BaseWorkingPath, jobRunID, fs.PathID),
	}

	if err := proto.UnmountPath(jobRunID, payload, true); err != nil {
		return fmt.Errorf("unmounting %s at %s: %w", protocolType, fs.Hostname, err)
	}

	return nil
}

// getProtocolType extracts the protocol type string from file server details.
func getProtocolType(fs types.FileServerDetails) string {
	if len(fs.Protocols) > 0 {
		return fs.Protocols[0].Type
	}
	return ""
}
