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

// PreCheckInput contains the parameters for the PreCheckPath activity.
type PreCheckInput struct {
	JobRunID              string                   `json:"jobRunId"`
	SourceFileServer      types.FileServerDetails  `json:"sourceFileServer"`
	SourcePath            string                   `json:"sourcePath"`
	DestinationFileServer *types.FileServerDetails `json:"destinationFileServer,omitempty"`
	DestinationPath       string                   `json:"destinationPath,omitempty"`
}

// PreCheckOutput contains the results of the PreCheckPath activity.
type PreCheckOutput struct {
	SourceAvailableSpace int64  `json:"sourceAvailableSpace"`
	TargetAvailableSpace int64  `json:"targetAvailableSpace"`
	SourceUsedSpace      int64  `json:"sourceUsedSpace"`
	Valid                bool   `json:"valid"`
	Message              string `json:"message,omitempty"`
}

// PreCheckPath performs pre-migration checks including mounting paths,
// validating they exist, checking disk space, and unmounting.
func (a *Activities) PreCheckPath(ctx context.Context, input PreCheckInput) (*PreCheckOutput, error) {
	a.Logger.Info("PreCheckPath started",
		zap.String("jobRunId", input.JobRunID),
		zap.String("sourceHost", input.SourceFileServer.Hostname),
	)

	output := &PreCheckOutput{Valid: true}

	// --- Source checks ---
	sourceProtoType := getProtocolType(input.SourceFileServer)
	if sourceProtoType == "" {
		return nil, fmt.Errorf("no protocol type found for source file server %s", input.SourceFileServer.Hostname)
	}

	sourceProto := protocols.NewProtocol(sourceProtoType, a.Config, a.Logger)
	if sourceProto == nil {
		return nil, fmt.Errorf("unsupported source protocol type: %s", sourceProtoType)
	}

	sourcePayload := protocols.ProtocolPayload{
		Hostname:        input.SourceFileServer.Hostname,
		Username:        input.SourceFileServer.Username,
		Password:        input.SourceFileServer.Password,
		Path:            input.SourceFileServer.Path,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        input.JobRunID,
		PathID:          input.SourceFileServer.PathID,
		ProtocolVersion: input.SourceFileServer.ProtocolVersion,
		DirPath:         filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.SourceFileServer.PathID),
	}

	// Mount source.
	if err := sourceProto.MountPath(input.JobRunID, sourcePayload, false); err != nil {
		output.Valid = false
		output.Message = fmt.Sprintf("failed to mount source: %v", err)
		return output, nil
	}

	// Validate source path exists.
	sourceMountDir := protocols.GetMountDir(sourcePayload)
	sourceFullPath := filepath.Join(sourceMountDir, input.SourcePath)
	if _, err := os.Stat(sourceFullPath); err != nil {
		_ = sourceProto.UnmountPath(input.JobRunID, sourcePayload, false)
		output.Valid = false
		output.Message = fmt.Sprintf("source path not accessible: %v", err)
		return output, nil
	}

	// Check source disk space.
	if a.Config.CheckAvailableDiskSpace {
		sourcePayload.DirPath = sourceFullPath
		usedSpace, err := sourceProto.GetTotalUsedMemory(input.JobRunID, sourcePayload)
		if err != nil {
			a.Logger.Warn("failed to get source used space", zap.Error(err))
		} else {
			output.SourceUsedSpace = usedSpace
		}
	}

	// --- Destination checks ---
	if input.DestinationFileServer != nil {
		destProtoType := getProtocolType(*input.DestinationFileServer)
		if destProtoType == "" {
			_ = sourceProto.UnmountPath(input.JobRunID, sourcePayload, false)
			output.Valid = false
			output.Message = "no protocol type found for destination file server"
			return output, nil
		}

		destProto := protocols.NewProtocol(destProtoType, a.Config, a.Logger)
		if destProto == nil {
			_ = sourceProto.UnmountPath(input.JobRunID, sourcePayload, false)
			output.Valid = false
			output.Message = fmt.Sprintf("unsupported destination protocol type: %s", destProtoType)
			return output, nil
		}

		destPayload := protocols.ProtocolPayload{
			Hostname:        input.DestinationFileServer.Hostname,
			Username:        input.DestinationFileServer.Username,
			Password:        input.DestinationFileServer.Password,
			Path:            input.DestinationFileServer.Path,
			MountBasePath:   a.Config.BaseWorkingPath,
			JobRunID:        input.JobRunID,
			PathID:          input.DestinationFileServer.PathID,
			ProtocolVersion: input.DestinationFileServer.ProtocolVersion,
			DirPath:         filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.DestinationFileServer.PathID),
		}

		// Mount destination.
		if err := destProto.MountPath(input.JobRunID, destPayload, false); err != nil {
			_ = sourceProto.UnmountPath(input.JobRunID, sourcePayload, false)
			output.Valid = false
			output.Message = fmt.Sprintf("failed to mount destination: %v", err)
			return output, nil
		}

		// Validate destination path exists.
		destMountDir := protocols.GetMountDir(destPayload)
		destFullPath := filepath.Join(destMountDir, input.DestinationPath)
		if _, err := os.Stat(destFullPath); err != nil {
			a.Logger.Warn("destination path does not exist, will be created",
				zap.String("path", destFullPath),
			)
		}

		// Check destination disk space.
		if a.Config.CheckAvailableDiskSpace {
			destPayload.DirPath = destFullPath
			availSpace, err := destProto.GetAvailableDiskSpace(input.JobRunID, destPayload)
			if err != nil {
				a.Logger.Warn("failed to get destination available space", zap.Error(err))
			} else {
				output.TargetAvailableSpace = availSpace
			}

			// Compare: destination must have enough space for source data.
			if output.SourceUsedSpace > 0 && output.TargetAvailableSpace > 0 {
				if output.SourceUsedSpace > output.TargetAvailableSpace {
					output.Valid = false
					output.Message = fmt.Sprintf(
						"insufficient disk space on destination: need %d bytes, have %d bytes",
						output.SourceUsedSpace,
						output.TargetAvailableSpace,
					)
				}
			}
		}

		// Unmount destination.
		if err := destProto.UnmountPath(input.JobRunID, destPayload, false); err != nil {
			a.Logger.Warn("failed to unmount destination after precheck", zap.Error(err))
		}
	}

	// Unmount source.
	if err := sourceProto.UnmountPath(input.JobRunID, sourcePayload, false); err != nil {
		a.Logger.Warn("failed to unmount source after precheck", zap.Error(err))
	}

	a.Logger.Info("PreCheckPath completed",
		zap.String("jobRunId", input.JobRunID),
		zap.Bool("valid", output.Valid),
	)

	return output, nil
}
