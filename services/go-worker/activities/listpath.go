package activities

import (
	"context"
	"fmt"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/protocols"
	"github.com/netapp/ndm/services/go-worker/types"
)

// ListPathInput contains the parameters for the ListPaths activity.
type ListPathInput struct {
	JobRunID   string                  `json:"jobRunId"`
	FileServer types.FileServerDetails `json:"fileServer"`
}

// ListPaths lists available paths (shares or exports) on a file server using
// the configured protocol (SMB or NFS).
func (a *Activities) ListPaths(ctx context.Context, input ListPathInput) ([]string, error) {
	a.Logger.Info("ListPaths",
		zap.String("jobRunId", input.JobRunID),
		zap.String("hostname", input.FileServer.Hostname),
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

	paths, err := proto.ListPaths(input.JobRunID, payload)
	if err != nil {
		return nil, fmt.Errorf("listing paths on %s: %w", input.FileServer.Hostname, err)
	}

	a.Logger.Info("ListPaths completed",
		zap.String("hostname", input.FileServer.Hostname),
		zap.Int("count", len(paths)),
	)

	return paths, nil
}
