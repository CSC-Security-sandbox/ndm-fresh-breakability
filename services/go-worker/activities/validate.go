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

// ValidateInput contains the parameters for the ValidateConnection activity.
type ValidateInput struct {
	JobRunID   string                   `json:"jobRunId"`
	FileServer types.FileServerDetails  `json:"fileServer"`
}

// ValidatePathInput contains the parameters for the ValidatePath activity.
type ValidatePathInput struct {
	JobRunID   string                   `json:"jobRunId"`
	FileServer types.FileServerDetails  `json:"fileServer"`
	Path       string                   `json:"path"`
}

// ValidatePathOutput contains the results of the ValidatePath activity.
type ValidatePathOutput struct {
	Valid   bool   `json:"valid"`
	Message string `json:"message,omitempty"`
}

// WorkDirInput contains the parameters for the ValidateWorkingDirectory activity.
type WorkDirInput struct {
	JobRunID   string                   `json:"jobRunId"`
	FileServer types.FileServerDetails  `json:"fileServer"`
	Path       string                   `json:"path"`
}

// DirInput contains the parameters for the IsValidDirectory activity.
type DirInput struct {
	JobRunID string `json:"jobRunId"`
	Path     string `json:"path"`
	PathID   string `json:"pathId"`
}

// ValidateConnection validates that the worker can connect to the file server
// using the configured protocol (SMB or NFS).
func (a *Activities) ValidateConnection(ctx context.Context, input ValidateInput) error {
	a.Logger.Info("ValidateConnection",
		zap.String("jobRunId", input.JobRunID),
		zap.String("hostname", input.FileServer.Hostname),
	)

	protocolType := getProtocolType(input.FileServer)
	if protocolType == "" {
		return fmt.Errorf("no protocol type found for file server %s", input.FileServer.Hostname)
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		return fmt.Errorf("unsupported protocol type: %s", protocolType)
	}

	payload := protocols.ProtocolPayload{
		Hostname:        input.FileServer.Hostname,
		Username:        input.FileServer.Username,
		Password:        input.FileServer.Password,
		Path:            input.FileServer.Path,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        input.JobRunID,
		PathID:          input.FileServer.PathID,
		ProtocolVersion: input.FileServer.ProtocolVersion,
	}

	if err := proto.ValidateConnection(input.JobRunID, payload); err != nil {
		return fmt.Errorf("validating connection to %s: %w", input.FileServer.Hostname, err)
	}

	a.Logger.Info("ValidateConnection succeeded",
		zap.String("hostname", input.FileServer.Hostname),
	)
	return nil
}

// ValidatePath mounts the file server, checks that the given path exists and
// is accessible, then unmounts.
func (a *Activities) ValidatePath(ctx context.Context, input ValidatePathInput) (*ValidatePathOutput, error) {
	a.Logger.Info("ValidatePath",
		zap.String("jobRunId", input.JobRunID),
		zap.String("hostname", input.FileServer.Hostname),
		zap.String("path", input.Path),
	)

	protocolType := getProtocolType(input.FileServer)
	if protocolType == "" {
		return nil, fmt.Errorf("no protocol type found for file server %s", input.FileServer.Hostname)
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		return nil, fmt.Errorf("unsupported protocol type: %s", protocolType)
	}

	payload := protocols.ProtocolPayload{
		Hostname:        input.FileServer.Hostname,
		Username:        input.FileServer.Username,
		Password:        input.FileServer.Password,
		Path:            input.FileServer.Path,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        input.JobRunID,
		PathID:          input.FileServer.PathID,
		ProtocolVersion: input.FileServer.ProtocolVersion,
		DirPath:         filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.FileServer.PathID),
	}

	// Mount.
	if err := proto.MountPath(input.JobRunID, payload, false); err != nil {
		return &ValidatePathOutput{
			Valid:   false,
			Message: fmt.Sprintf("failed to mount: %v", err),
		}, nil
	}

	// Validate the path exists.
	mountDir := protocols.GetMountDir(payload)
	fullPath := filepath.Join(mountDir, input.Path)

	stat, err := os.Stat(fullPath)
	if err != nil {
		// Unmount before returning.
		_ = proto.UnmountPath(input.JobRunID, payload, false)
		return &ValidatePathOutput{
			Valid:   false,
			Message: fmt.Sprintf("path not found: %v", err),
		}, nil
	}

	if !stat.IsDir() {
		_ = proto.UnmountPath(input.JobRunID, payload, false)
		return &ValidatePathOutput{
			Valid:   false,
			Message: "path is not a directory",
		}, nil
	}

	// Unmount.
	if err := proto.UnmountPath(input.JobRunID, payload, false); err != nil {
		a.Logger.Warn("failed to unmount after validation",
			zap.String("jobRunId", input.JobRunID),
			zap.Error(err),
		)
	}

	return &ValidatePathOutput{Valid: true}, nil
}

// ValidateWorkingDirectory checks that the working directory path exists and
// is writable on the file server.
func (a *Activities) ValidateWorkingDirectory(ctx context.Context, input WorkDirInput) error {
	a.Logger.Info("ValidateWorkingDirectory",
		zap.String("jobRunId", input.JobRunID),
		zap.String("path", input.Path),
	)

	protocolType := getProtocolType(input.FileServer)
	if protocolType == "" {
		return fmt.Errorf("no protocol type found for file server %s", input.FileServer.Hostname)
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		return fmt.Errorf("unsupported protocol type: %s", protocolType)
	}

	payload := protocols.ProtocolPayload{
		Hostname:        input.FileServer.Hostname,
		Username:        input.FileServer.Username,
		Password:        input.FileServer.Password,
		Path:            input.FileServer.Path,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        input.JobRunID,
		PathID:          input.FileServer.PathID,
		ProtocolVersion: input.FileServer.ProtocolVersion,
		DirPath:         filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.FileServer.PathID),
	}

	// Mount.
	if err := proto.MountPath(input.JobRunID, payload, false); err != nil {
		return fmt.Errorf("mounting for working directory validation: %w", err)
	}
	defer func() {
		_ = proto.UnmountPath(input.JobRunID, payload, false)
	}()

	// Check that the working directory exists or can be created.
	mountDir := protocols.GetMountDir(payload)
	workDir := filepath.Join(mountDir, input.Path)

	if err := os.MkdirAll(workDir, 0755); err != nil {
		return fmt.Errorf("creating working directory %s: %w", workDir, err)
	}

	// Verify it is writable by creating and removing a temp file.
	testFile := filepath.Join(workDir, ".ndm_write_test")
	f, err := os.Create(testFile)
	if err != nil {
		return fmt.Errorf("working directory %s is not writable: %w", workDir, err)
	}
	f.Close()
	os.Remove(testFile)

	a.Logger.Info("ValidateWorkingDirectory succeeded",
		zap.String("path", input.Path),
	)
	return nil
}

// IsValidDirectory checks whether the given directory path exists and is a
// directory on the mounted file server.
func (a *Activities) IsValidDirectory(ctx context.Context, input DirInput) (bool, error) {
	a.Logger.Info("IsValidDirectory",
		zap.String("jobRunId", input.JobRunID),
		zap.String("path", input.Path),
	)

	mountDir := filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.PathID)
	fullPath := filepath.Join(mountDir, input.Path)

	stat, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("checking directory %s: %w", fullPath, err)
	}

	return stat.IsDir(), nil
}
