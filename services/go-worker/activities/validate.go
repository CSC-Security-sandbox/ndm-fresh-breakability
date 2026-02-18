package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

// WorkDirResponse is the response returned by the ValidateWorkingDirectory
// activity. It matches the TypeScript ValidateWorkingDirectoryActivity
// .validateWorkingDirectory() return shape exactly.
type WorkDirResponse struct {
	TraceID  string `json:"traceId"`
	Status   string `json:"status"`
	WorkerID string `json:"workerId"`
	Message  string `json:"message"`
}

// ConfigStatusPayload is the payload sent to the config-service to update
// the configuration status after working directory validation.
type ConfigStatusPayload struct {
	ConfigID     string  `json:"configId"`
	Status       *string `json:"status"`
	ErrorMessage *string `json:"errorMessage"`
	FileServerID *string `json:"fileServerId,omitempty"`
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

// ValidateWorkingDirectory validates the export path and working directory for
// a single worker. Its signature matches the TypeScript
// ValidateWorkingDirectoryActivity.validateWorkingDirectory():
//
//	validateWorkingDirectory(traceId: string, payload: any): Promise<any>
//
// The workflow calls it with two positional args (traceID, payload).
func (a *Activities) ValidateWorkingDirectory(
	ctx context.Context,
	traceID string,
	payload map[string]interface{},
) (*WorkDirResponse, error) {
	a.Logger.Info("ValidateWorkingDirectory",
		zap.String("traceId", traceID),
	)

	configID, _ := payload["configId"].(string)
	fileServerID, _ := payload["fileServerId"].(string)

	configStatus := &ConfigStatusPayload{
		ConfigID: configID,
	}
	if fileServerID != "" {
		configStatus.FileServerID = &fileServerID
	}

	serverType, _ := payload["serverType"].(string)
	isStorageAware := serverType != "OtherNAS"

	// Check if paths exist.
	pathsRaw, _ := payload["paths"].([]interface{})
	isPathExists := len(pathsRaw) > 0

	// Check if storage-aware has discovered exports via exportsMap.
	hasDiscoveredExports := false
	if isStorageAware {
		if exportsMap, ok := payload["exportsMap"].(map[string]interface{}); ok && len(exportsMap) > 0 {
			hasDiscoveredExports = true
		}
	}

	hasManualUpload, _ := payload["hasManualUpload"].(bool)

	if !isPathExists && !hasManualUpload && !hasDiscoveredExports {
		errMsg := "The system couldn't retrieve the export path from the file server, possibly because the path is set to the root (/) which is not a valid or mountable path, or the server doesn't support the showmount command. Verify the export settings or try manual upload option."
		statusStr := "ERRORED"
		configStatus.Status = &statusStr
		configStatus.ErrorMessage = &errMsg
		a.updateConfigStatus(traceID, configStatus)
		return &WorkDirResponse{
			TraceID:  traceID,
			Status:   "error",
			WorkerID: a.Config.WorkerID,
			Message:  errMsg,
		}, nil
	}

	exportPathProvided, _ := payload["exportPathWorkingDirectoryProvided"].(bool)

	if !exportPathProvided {
		// Export path not provided — mount/unmount to validate connectivity.
		a.Logger.Info("Export Path not provided, fetching from file server")
		if err := a.handleMountAndUnmountPaths(traceID, payload); err != nil {
			errMsg := a.getNfsMountErrorMessage(err)
			a.Logger.Error(fmt.Sprintf("Error while mounting: %s", errMsg))
			statusStr := "ERRORED"
			configStatus.Status = &statusStr
			configStatus.ErrorMessage = &errMsg
		} else {
			a.Logger.Info("Export Path fetched successfully")
			statusStr := "ACTIVE"
			configStatus.Status = &statusStr
			configStatus.ErrorMessage = nil
		}
	} else {
		exportPathPresent, _ := payload["exportPathPresent"].(bool)
		if !exportPathPresent {
			a.Logger.Info("Invalid Export Path")
			statusStr := "ERRORED"
			errMsg := "Invalid export path"
			configStatus.Status = &statusStr
			configStatus.ErrorMessage = &errMsg
		} else {
			a.Logger.Info("Valid Export Path — validating working directory")
			isValid, err := a.isValidDirectory(payload, traceID)
			if err != nil {
				errMsg := a.getNfsMountErrorMessage(err)
				a.Logger.Error(fmt.Sprintf("Working directory validation error: %s", errMsg))
				statusStr := "ERRORED"
				configStatus.Status = &statusStr
				configStatus.ErrorMessage = &errMsg
			} else if isValid {
				statusStr := "ACTIVE"
				configStatus.Status = &statusStr
				configStatus.ErrorMessage = nil
			} else {
				statusStr := "ERRORED"
				errMsg := "Invalid working directory"
				configStatus.Status = &statusStr
				configStatus.ErrorMessage = &errMsg
			}
		}
	}

	a.updateConfigStatus(traceID, configStatus)

	status := "success"
	var message string
	if configStatus.Status != nil && *configStatus.Status != "ACTIVE" {
		status = "error"
		if configStatus.ErrorMessage != nil {
			message = fmt.Sprintf("Validation failed: %s", *configStatus.ErrorMessage)
		}
	} else {
		message = fmt.Sprintf("Export path and Working directory validated successfully for workerId %s", a.Config.WorkerID)
	}

	return &WorkDirResponse{
		TraceID:  traceID,
		Status:   status,
		WorkerID: a.Config.WorkerID,
		Message:  message,
	}, nil
}

// handleMountAndUnmountPaths mounts and unmounts export paths to validate
// connectivity, matching the TypeScript handleMountAndUnmountPaths method.
func (a *Activities) handleMountAndUnmountPaths(traceID string, payload map[string]interface{}) error {
	isStorageAware := false
	if st, ok := payload["serverType"].(string); ok {
		isStorageAware = st != "OtherNAS"
	}

	listPathPayloadRaw, _ := payload["listPathPayload"].([]interface{})
	fetchedPath, _ := payload["fetchedPath"].(string)
	fileServerID, _ := payload["fileServerId"].(string)

	for _, lpRaw := range listPathPayloadRaw {
		lp, ok := lpRaw.(map[string]interface{})
		if !ok {
			continue
		}

		exportPathSource, _ := lp["exportPathSource"].(string)
		if exportPathSource == "MANUAL_UPLOAD" {
			a.Logger.Info(fmt.Sprintf("Skipping mounting and unmounting for MANUAL_UPLOAD type for host %s", lp["host"]))
			continue
		}

		protocolType, _ := lp["type"].(string)
		proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
		if proto == nil {
			return fmt.Errorf("unsupported protocol type: %s", protocolType)
		}

		// For storage-aware types, get the export path from exportsMap for this specific host.
		exportPath := fetchedPath
		if isStorageAware {
			if exportsMap, ok := payload["exportsMap"].(map[string]interface{}); ok {
				host, _ := lp["host"].(string)
				if v, ok := exportsMap[host].(string); ok {
					exportPath = v
					a.Logger.Info(fmt.Sprintf("Using discovered export path %s for host %s", exportPath, host))
				}
			}
		}

		host, _ := lp["host"].(string)
		username, _ := lp["username"].(string)
		password, _ := lp["password"].(string)
		protocolVersion, _ := lp["protocolVersion"].(string)

		// For storage-aware per-zone, include fileServerId in path to prevent collision.
		uniquePathID := traceID
		if fileServerID != "" {
			uniquePathID = fmt.Sprintf("%s-%s", traceID, fileServerID)
		}

		mountPayload := protocols.ProtocolPayload{
			Hostname:        host,
			Username:        username,
			Password:        password,
			ProtocolVersion: protocolVersion,
			Path:            exportPath,
			MountBasePath:   a.Config.BaseWorkingPath,
			PathID:          uniquePathID,
			JobRunID:        uniquePathID,
		}

		a.Logger.Info(fmt.Sprintf("Mounting export path for host %s", host))
		if err := proto.MountPath(traceID, mountPayload, false); err != nil {
			return fmt.Errorf("Error while mounting the path - %w", err)
		}
		a.Logger.Info("Mounted export path successfully")

		a.Logger.Info(fmt.Sprintf("Unmounting export path for host %s", host))
		if err := proto.UnmountPath(traceID, mountPayload, false); err != nil {
			a.Logger.Warn("Unmount failed (non-fatal)", zap.Error(err))
		}
		a.Logger.Info("Unmounted export path successfully")
	}

	return nil
}

// isValidDirectory validates the working directory by mounting, checking
// existence and write permissions, matching the TypeScript isValidDirectory method.
func (a *Activities) isValidDirectory(payload map[string]interface{}, traceID string) (bool, error) {
	isDirectoryValid := false
	hasWritePermission := false

	fileServerID, _ := payload["fileServerId"].(string)
	uniquePathID := traceID
	if fileServerID != "" {
		uniquePathID = fmt.Sprintf("%s-%s", traceID, fileServerID)
	}

	exportPath, _ := payload["exportPath"].(string)
	workingDirectory, _ := payload["workingDirectory"].(string)

	listPathPayloadRaw, _ := payload["listPathPayload"].([]interface{})

	for _, lpRaw := range listPathPayloadRaw {
		lp, ok := lpRaw.(map[string]interface{})
		if !ok {
			continue
		}

		protocolType, _ := lp["type"].(string)
		proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
		if proto == nil {
			return false, fmt.Errorf("unsupported protocol type: %s", protocolType)
		}

		host, _ := lp["host"].(string)
		username, _ := lp["username"].(string)
		password, _ := lp["password"].(string)
		protocolVersion, _ := lp["protocolVersion"].(string)

		mountPayload := protocols.ProtocolPayload{
			Hostname:        host,
			Username:        username,
			Password:        password,
			ProtocolVersion: protocolVersion,
			Path:            exportPath,
			MountBasePath:   a.Config.BaseWorkingPath,
			PathID:          uniquePathID,
			JobRunID:        uniquePathID,
		}

		a.Logger.Info(fmt.Sprintf("Mounting export path for host %s", host))
		if err := proto.MountPath(traceID, mountPayload, false); err != nil {
			return false, err
		}
		a.Logger.Info("Mounted export path successfully")

		a.Logger.Info("Started validating the working directory")
		mountPoint := filepath.Join(a.Config.BaseWorkingPath, uniquePathID, uniquePathID)
		fullPath := filepath.Join(mountPoint, workingDirectory)

		stat, err := os.Stat(fullPath)
		if err == nil && stat.IsDir() {
			a.Logger.Info(fmt.Sprintf("Working Directory exists: %s", fullPath))
			isDirectoryValid = true

			// Check write permission.
			testFile := filepath.Join(fullPath, ".nfs_write_test")
			f, writeErr := os.Create(testFile)
			if writeErr != nil {
				a.Logger.Error(fmt.Sprintf("No write permission for directory %s - %v", fullPath, writeErr))
				hasWritePermission = false
			} else {
				f.Close()
				os.Remove(testFile)
				a.Logger.Info(fmt.Sprintf("Directory %s is writable", fullPath))
				hasWritePermission = true
			}
		} else {
			a.Logger.Info(fmt.Sprintf("Working Directory does not exist: %s", fullPath))
		}

		a.Logger.Info(fmt.Sprintf("Unmounting export path for host %s", host))
		if err := proto.UnmountPath(traceID, mountPayload, false); err != nil {
			a.Logger.Warn("Unmount failed (non-fatal)", zap.Error(err))
		}
		a.Logger.Info("Unmounted export path successfully")

		if isDirectoryValid && !hasWritePermission {
			return false, fmt.Errorf("Provided working directory %s has no writable permission", workingDirectory)
		}

		if isDirectoryValid && hasWritePermission {
			break
		}
	}

	return isDirectoryValid && hasWritePermission, nil
}

// updateConfigStatus posts the config status payload to the config-service API,
// matching the TypeScript updateConfigStatus method.
func (a *Activities) updateConfigStatus(traceID string, status *ConfigStatusPayload) {
	apiURL := fmt.Sprintf("%s/api/v1/work-manager/validate/working-directory", a.Config.ConfigServiceURL)

	bodyBytes, err := json.Marshal(status)
	if err != nil {
		a.Logger.Error("Failed to marshal config status payload", zap.Error(err))
		return
	}

	_, err = a.HTTP.Post(apiURL, bodyBytes, nil)
	if err != nil {
		a.Logger.Error("Failed to update config status", zap.String("traceId", traceID), zap.Error(err))
	}
}

// getNfsMountErrorMessage maps mount errors to user-friendly messages,
// matching the TypeScript getNfsMountErrorMessage method.
func (a *Activities) getNfsMountErrorMessage(err error) string {
	msg := err.Error()

	switch {
	case strings.Contains(msg, "illegal NFS version value"),
		strings.Contains(msg, "RPC prog. not avail"),
		strings.Contains(msg, "Protocol not supported for"),
		strings.Contains(msg, "version") && strings.Contains(msg, "mismatch"):
		return "The server does not support provided protocol version. Please use a valid protocol version."
	case strings.Contains(msg, "port") && (strings.Contains(msg, "blocked") || strings.Contains(msg, "filtered")):
		return "Protocol port is blocked or not accessible"
	case strings.Contains(msg, "os") && (strings.Contains(msg, "not supported") || strings.Contains(msg, "unsupported")):
		return "The operation is not supported by the host operating system."
	default:
		return msg
	}
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
