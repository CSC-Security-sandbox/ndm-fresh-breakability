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

// ValidateConnectionResponse is the response returned by the Validate activity
// (called from ValidateWorkerConnectionWorkflow). It matches the TypeScript
// ValidateConnectionActivity.validate() return shape exactly so that the config
// service and UI can parse the results.
type ValidateConnectionResponse struct {
	TraceID          string   `json:"traceId"`
	Status           string   `json:"status"`
	ProtocolType     string   `json:"protocolType"`
	Hostname         string   `json:"hostname"`
	WorkerID         string   `json:"workerId"`
	Paths            []string `json:"paths"`
	ProtocolVersions []string `json:"protocolVersions"`
	Message          string   `json:"message"`
}

// ValidatePathInput contains the parameters for the ValidatePath activity.
type ValidatePathInput struct {
	JobRunID   string                  `json:"jobRunId"`
	FileServer types.FileServerDetails `json:"fileServer"`
	Path       string                  `json:"path"`
}

// ValidatePathOutput contains the results of the ValidatePath activity.
type ValidatePathOutput struct {
	Valid   bool   `json:"valid"`
	Message string `json:"message,omitempty"`
}

// WorkDirInput contains the parameters for the ValidateWorkingDirectory activity.
type WorkDirInput struct {
	JobRunID   string                  `json:"jobRunId"`
	FileServer types.FileServerDetails `json:"fileServer"`
	Path       string                  `json:"path"`
}

// DirInput contains the parameters for the IsValidDirectory activity.
type DirInput struct {
	JobRunID string `json:"jobRunId"`
	Path     string `json:"path"`
	PathID   string `json:"pathId"`
}

// ValidateConnection is the activity called from ValidateWorkerConnectionWorkflow
// to validate connectivity for a single protocol. Its signature mirrors the
// TypeScript ValidateConnectionActivity.validate() method:
//
//	validate(traceId: string, protocolType: string, payload: any, feature: any): Promise<any>
//
// The Temporal Go SDK maps positional workflow.ExecuteActivity args to function
// parameters, so the 4 args from the workflow map to (traceID, protocolType,
// payload, feature) after the implicit context.Context.
//
// On success the response has status "success" and may include the list of
// export paths and protocol versions (if feature flags are enabled). On failure
// the response has status "error" with a descriptive message — errors are NOT
// returned via the error return value so that the parent workflow always gets
// a result object (matching the TypeScript behaviour where errors are caught
// and returned as a response).
func (a *Activities) ValidateConnection(
	ctx context.Context,
	traceID string,
	protocolType string,
	payload map[string]interface{},
	feature map[string]interface{},
) (*ValidateConnectionResponse, error) {
	hostname, _ := payload["hostname"].(string)

	a.Logger.Info("ValidateConnection activity started",
		zap.String("traceId", traceID),
		zap.String("protocolType", protocolType),
		zap.String("hostname", hostname),
		zap.String("workerId", a.Config.WorkerID),
	)

	response := &ValidateConnectionResponse{
		TraceID:          traceID,
		Status:           "success",
		ProtocolType:     protocolType,
		Hostname:         hostname,
		WorkerID:         a.Config.WorkerID,
		Paths:            []string{},
		ProtocolVersions: []string{},
		Message: fmt.Sprintf("[%s] Connection to %s from %s validated successfully",
			protocolType, hostname, a.Config.WorkerID),
	}

	// Build protocol payload from the raw map (same shape the TS workflow
	// spreads: { hostname, ...protocol }).
	username, _ := payload["username"].(string)
	password, _ := payload["password"].(string)

	protoPayload := protocols.ProtocolPayload{
		Hostname: hostname,
		Username: username,
		Password: password,
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		response.Status = "error"
		response.Message = fmt.Sprintf("Failed to validate connection for %s of type %s: unsupported protocol type",
			hostname, protocolType)
		a.Logger.Error("ValidateConnection: unsupported protocol",
			zap.String("traceId", traceID),
			zap.String("protocolType", protocolType),
		)
		return response, nil
	}

	// Validate connectivity.
	if err := proto.ValidateConnection(traceID, protoPayload); err != nil {
		response.Status = "error"
		response.Message = fmt.Sprintf("Failed to validate connection for %s of type %s: %v",
			hostname, protocolType, err)
		a.Logger.Error("ValidateConnection failed",
			zap.String("traceId", traceID),
			zap.String("hostname", hostname),
			zap.Error(err),
		)
		return response, nil
	}

	// Feature: list export paths if enabled.
	enablePreListPath, _ := feature["enablePreListPath"].(bool)
	if enablePreListPath {
		a.Logger.Info("ValidateConnection: listing paths",
			zap.String("traceId", traceID),
			zap.String("hostname", hostname),
		)
		paths, err := proto.ListPaths(traceID, protoPayload)
		if err != nil {
			a.Logger.Warn("ValidateConnection: listPaths failed (non-fatal)",
				zap.String("traceId", traceID),
				zap.Error(err),
			)
		} else {
			response.Paths = paths
		}
	}

	// Feature: get protocol versions if enabled.
	// Note: GetProtocolVersions is not yet implemented in the Go protocol
	// interface. Log a warning and return an empty list (matching TS
	// behaviour where an unimplemented call returns []).
	enableVersionFetch, _ := feature["enableVersionFetch"].(bool)
	if enableVersionFetch {
		a.Logger.Info("ValidateConnection: protocol version fetch requested but not yet implemented in Go worker",
			zap.String("traceId", traceID),
		)
		// response.ProtocolVersions remains []string{}
	}

	a.Logger.Info("ValidateConnection activity completed",
		zap.String("traceId", traceID),
		zap.String("hostname", hostname),
		zap.String("status", response.Status),
		zap.Int("pathCount", len(response.Paths)),
	)

	return response, nil
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
