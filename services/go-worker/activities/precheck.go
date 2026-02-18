package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/protocols"
)

// PreCheckSettings matches the TypeScript Settings interface used in pre-check
// workflows.
type PreCheckSettings struct {
	PreserveAccessTime bool `json:"preserveAccessTime"`
}

// PreCheckServerCredential matches the TypeScript ServerCredential interface.
type PreCheckServerCredential struct {
	ID               string `json:"id"`
	Host             string `json:"host"`
	UserName         string `json:"userName"`
	Password         string `json:"password"`
	Protocol         string `json:"protocol"`
	ProtocolVersion  string `json:"protocolVersion"`
	ServerType       string `json:"serverType"`
	ExportPathSource string `json:"exportPathSource"`
}

// PreCheckWorkerTaskPaths matches the TypeScript WorkerTaskPaths interface.
type PreCheckWorkerTaskPaths struct {
	PathID         string `json:"pathId"`
	ServerID       string `json:"serverId"`
	PathName       string `json:"pathName"`
	IsSource       bool   `json:"isSource"`
	DiscoveredSize *int64 `json:"discoveredSize,omitempty"`
}

// PreCheckPathInput wraps the 4 positional arguments that the TypeScript
// preCheckPath activity receives. By bundling them into a single struct we
// avoid Temporal's double-serialization issue that occurs when workflow code
// passes multiple `interface{}` values to ExecuteActivity.
//
// ServerCredentials and ServerPaths use json.RawMessage so the activity can
// accept both a single object and an array. This makes the deserialization
// robust against Temporal workflow replay from older workflow code that may
// have passed the full arrays instead of individual items.
type PreCheckPathInput struct {
	Settings          json.RawMessage `json:"settings"`
	ServerCredentials json.RawMessage `json:"serverCredentials"`
	ServerPaths       json.RawMessage `json:"serverPaths"`
	TraceID           string          `json:"traceId"`
}

// PreCheckPathOutput matches the TypeScript PreCheckPathOutput interface.
type PreCheckPathOutput struct {
	PathID                    string   `json:"pathId"`
	Status                    string   `json:"status"`
	ErrorCodes                []string `json:"errorCodes"`
	WorkerID                  string   `json:"workerId"`
	SourceDataSize            *int64   `json:"sourceDataSize,omitempty"`
	DestinationAvailableSpace *int64   `json:"destinationAvailableSpace,omitempty"`
}

// PreCheckPath performs pre-check validation for a single path (source or
// destination). This matches the TypeScript PrecheckActivity.preCheckPath().
//
// The activity receives a single PreCheckPathInput struct that bundles the
// 4 positional arguments from the TS version:
//
//	preCheckPath(settings, serverCredentials, serverPaths, traceId)
func (a *Activities) PreCheckPath(ctx context.Context, input PreCheckPathInput) (*PreCheckPathOutput, error) {
	traceID := input.TraceID

	// --- Parse settings (always a single object) ---
	var settings PreCheckSettings
	if len(input.Settings) > 0 {
		_ = json.Unmarshal(input.Settings, &settings) // defaults to zero-value on error
	}

	// --- Parse serverPaths (should be a single object; reject arrays) ---
	serverPaths, err := resolveServerPaths(input.ServerPaths)
	if err != nil {
		return nil, fmt.Errorf("resolving server paths: %w", err)
	}

	// --- Parse serverCredentials (single object or array) ---
	serverCred, err := resolveServerCredential(input.ServerCredentials, serverPaths.ServerID)
	if err != nil {
		return nil, fmt.Errorf("resolving server credential: %w", err)
	}

	a.Logger.Info("PreCheckPath started",
		zap.String("traceId", traceID),
		zap.String("host", serverCred.Host),
		zap.String("pathName", serverPaths.PathName),
		zap.Bool("isSource", serverPaths.IsSource),
	)

	output := &PreCheckPathOutput{
		PathID:     serverPaths.PathID,
		Status:     "success",
		ErrorCodes: []string{},
		WorkerID:   a.Config.WorkerID,
	}

	// Resolve protocol type from credentials.
	protoType := serverCred.Protocol
	if protoType == "" {
		return nil, fmt.Errorf("no protocol type found for server %s", serverCred.Host)
	}

	proto := protocols.NewProtocol(protoType, a.Config, a.Logger)
	if proto == nil {
		return nil, fmt.Errorf("unsupported protocol type: %s", protoType)
	}

	payload := protocols.ProtocolPayload{
		Hostname:        serverCred.Host,
		Username:        serverCred.UserName,
		Password:        serverCred.Password,
		ProtocolVersion: serverCred.ProtocolVersion,
		MountBasePath:   a.Config.BaseWorkingPath,
		JobRunID:        traceID,
		PathID:          serverPaths.PathID,
		Path:            serverPaths.PathName,
	}

	// --- Validate connection and mount the path ---
	// TS calls validateConnection() then mountPath().
	mountSuccess := false
	if err := proto.ValidateConnection(traceID, payload); err != nil {
		a.Logger.Error("Error validating connection",
			zap.String("pathName", serverPaths.PathName),
			zap.String("host", serverCred.Host),
			zap.Error(err),
		)
		if serverPaths.IsSource {
			output.ErrorCodes = append(output.ErrorCodes, "SOURCE_PATH_MOUNT_FAILED")
		} else {
			output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_PATH_MOUNT_FAILED")
		}
	} else if err := proto.MountPath(traceID, payload, false); err != nil {
		a.Logger.Error("Error mounting path",
			zap.String("pathName", serverPaths.PathName),
			zap.String("host", serverCred.Host),
			zap.Error(err),
		)
		if serverPaths.IsSource {
			output.ErrorCodes = append(output.ErrorCodes, "SOURCE_PATH_MOUNT_FAILED")
		} else {
			output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_PATH_MOUNT_FAILED")
		}
	} else {
		mountSuccess = true
	}

	if mountSuccess {
		mountDir := filepath.Join(a.Config.BaseWorkingPath, traceID, serverPaths.PathID)

		// --- AUTO_DISCOVER path validation ---
		// TS checks if exportPathSource === AUTO_DISCOVER, then calls
		// protocol.listPaths() to verify the path exists on the server.
		if serverCred.ExportPathSource == "AUTO_DISCOVER" {
			pathList, err := proto.ListPaths(traceID, payload)
			if err != nil {
				a.Logger.Error("Error listing paths on server",
					zap.String("host", serverCred.Host),
					zap.Error(err),
				)
				if serverPaths.IsSource {
					output.ErrorCodes = append(output.ErrorCodes, "SOURCE_PATH_NOT_FOUND")
				} else {
					output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_PATH_NOT_FOUND")
				}
			} else {
				found := false
				for _, p := range pathList {
					if p == serverPaths.PathName {
						found = true
						break
					}
				}
				if !found {
					a.Logger.Error("Path not found on server",
						zap.String("pathName", serverPaths.PathName),
						zap.String("host", serverCred.Host),
					)
					if serverPaths.IsSource {
						output.ErrorCodes = append(output.ErrorCodes, "SOURCE_PATH_NOT_FOUND")
					} else {
						output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_PATH_NOT_FOUND")
					}
				}
			}
		}

		// --- Write permission check ---
		// TS checks write permission if preserveAccessTime is true OR if destination.
		a.Logger.Info("PreCheck permission check",
			zap.Bool("preserveAccessTime", settings.PreserveAccessTime),
			zap.Bool("isDestination", !serverPaths.IsSource),
		)

		if settings.PreserveAccessTime || !serverPaths.IsSource {
			testFile := filepath.Join(mountDir, fmt.Sprintf("test-%s-%s.txt", traceID, a.Config.WorkerID))
			if err := writeAndDeleteTestFile(testFile); err != nil {
				// Check for ENOSPC (no space left on device) specifically.
				if isNoSpaceError(err) {
					a.Logger.Error("No space left on device",
						zap.String("host", serverCred.Host),
						zap.Error(err),
					)
					if serverPaths.IsSource {
						output.ErrorCodes = append(output.ErrorCodes, "NO_SPACE_LEFT_ON_SOURCE_PATH")
					} else {
						output.ErrorCodes = append(output.ErrorCodes, "NO_SPACE_LEFT_ON_DESTINATION_PATH")
					}
				} else {
					a.Logger.Error("Error creating test file",
						zap.String("host", serverCred.Host),
						zap.Error(err),
					)
					if serverPaths.IsSource {
						output.ErrorCodes = append(output.ErrorCodes, "SOURCE_PATH_WRITE_PERMISSION_FAILED")
					} else {
						output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_PATH_WRITE_PERMISSION_FAILED")
					}
				}
			}
		}

		// --- Source-specific checks ---
		if serverPaths.IsSource && a.Config.CheckAvailableDiskSpace {
			sizePayload := payload
			sizePayload.Path = mountDir
			sizePayload.DirPath = mountDir

			isToCalculateSpace := serverPaths.DiscoveredSize == nil || *serverPaths.DiscoveredSize < 0
			if isToCalculateSpace {
				totalSize, err := proto.GetTotalUsedMemory(traceID, sizePayload)
				if err != nil {
					a.Logger.Error("Error calculating source data size",
						zap.String("host", serverCred.Host),
						zap.Error(err),
					)
					output.ErrorCodes = append(output.ErrorCodes, "SOURCE_DATA_SIZE_CALCULATION_FAILED")
				} else {
					a.Logger.Info("SourceDataSize", zap.Int64("bytes", totalSize))
					output.SourceDataSize = &totalSize
				}
			} else {
				a.Logger.Info("SourceDataSize (discovered)", zap.Int64("bytes", *serverPaths.DiscoveredSize))
				output.SourceDataSize = serverPaths.DiscoveredSize
			}
		}

		// --- Destination-specific checks ---
		if !serverPaths.IsSource && a.Config.CheckAvailableDiskSpace {
			spacePayload := payload
			spacePayload.Path = mountDir
			spacePayload.DirPath = mountDir

			availBytes, err := proto.GetAvailableDiskSpace(traceID, spacePayload)
			if err != nil {
				a.Logger.Error("Error calculating destination available space",
					zap.String("host", serverCred.Host),
					zap.Error(err),
				)
				output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_AVAILABLE_SPACE_CALCULATION_FAILED")
			} else {
				a.Logger.Info("Available space", zap.Int64("bytes", availBytes))
				output.DestinationAvailableSpace = &availBytes
			}
		}

		// --- Unmount ---
		if err := proto.UnmountPath(traceID, payload, false); err != nil {
			a.Logger.Warn("Error unmounting path",
				zap.String("pathName", serverPaths.PathName),
				zap.String("host", serverCred.Host),
				zap.Error(err),
			)
			if serverPaths.IsSource {
				output.ErrorCodes = append(output.ErrorCodes, "SOURCE_PATH_UNMOUNT_FAILED")
			} else {
				output.ErrorCodes = append(output.ErrorCodes, "DESTINATION_PATH_UNMOUNT_FAILED")
			}
		} else {
			a.Logger.Info("Unmounted path",
				zap.String("pathName", serverPaths.PathName),
				zap.String("host", serverCred.Host),
			)
		}
	}

	if len(output.ErrorCodes) > 0 {
		output.Status = "failed"
	}

	a.Logger.Info("PreCheckPath completed",
		zap.String("traceId", traceID),
		zap.String("pathId", serverPaths.PathID),
		zap.String("status", output.Status),
	)

	return output, nil
}

// isNoSpaceError checks whether the error is caused by ENOSPC (no space left
// on device), matching the TypeScript error.code === 'ENOSPC' check.
func isNoSpaceError(err error) bool {
	if err == nil {
		return false
	}
	// Check for syscall.ENOSPC in the error chain.
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		if errors.Is(pathErr.Err, syscall.ENOSPC) {
			return true
		}
	}
	return errors.Is(err, syscall.ENOSPC)
}

// resolveServerPaths parses the raw JSON for server paths. It expects a single
// JSON object. If it receives an array (from a stale workflow replay), it
// returns an error since the activity cannot process multiple paths at once.
func resolveServerPaths(raw json.RawMessage) (PreCheckWorkerTaskPaths, error) {
	if len(raw) == 0 {
		return PreCheckWorkerTaskPaths{}, fmt.Errorf("empty serverPaths payload")
	}

	var single PreCheckWorkerTaskPaths
	if err := json.Unmarshal(raw, &single); err != nil {
		return PreCheckWorkerTaskPaths{}, fmt.Errorf("cannot parse serverPaths: %w (input may be an array from a stale workflow — terminate and retry)", err)
	}
	return single, nil
}

// resolveServerCredential parses the raw JSON for server credentials. It
// accepts either a single JSON object (the normal case when the workflow
// passes one credential) or a JSON array (if the full credentials list leaks
// through). When an array is received, the credential whose "id" matches
// serverID is returned.
func resolveServerCredential(raw json.RawMessage, serverID string) (PreCheckServerCredential, error) {
	if len(raw) == 0 {
		return PreCheckServerCredential{}, fmt.Errorf("empty serverCredentials payload")
	}

	// Try single object first (the expected common case).
	var single PreCheckServerCredential
	if err := json.Unmarshal(raw, &single); err == nil && single.ID != "" {
		return single, nil
	}

	// Fall back to array — find the matching credential by ID.
	var arr []PreCheckServerCredential
	if err := json.Unmarshal(raw, &arr); err != nil {
		return PreCheckServerCredential{}, fmt.Errorf("cannot parse serverCredentials as object or array: %w", err)
	}

	for _, c := range arr {
		if c.ID == serverID {
			return c, nil
		}
	}

	return PreCheckServerCredential{}, fmt.Errorf("server credential with id %q not found in array of %d credentials", serverID, len(arr))
}

// writeAndDeleteTestFile creates a test file, reads it, then removes it.
// This validates write permissions on the mounted path, matching the TS
// write-permission check.
func writeAndDeleteTestFile(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("creating test file: %w", err)
	}
	f.Close()

	if _, err := os.ReadFile(path); err != nil {
		return fmt.Errorf("reading test file: %w", err)
	}

	if err := os.Remove(path); err != nil {
		return fmt.Errorf("removing test file: %w", err)
	}

	return nil
}

// mapToPreCheckServerCredential converts a map[string]interface{} (from
// Temporal's JSON deserialization) into a typed PreCheckServerCredential.
// This is used by the workflow to build the typed input struct.
func mapToPreCheckServerCredential(m map[string]interface{}) PreCheckServerCredential {
	return PreCheckServerCredential{
		ID:               mapStr(m, "id"),
		Host:             mapStr(m, "host"),
		UserName:         mapStr(m, "userName"),
		Password:         mapStr(m, "password"),
		Protocol:         mapStr(m, "protocol"),
		ProtocolVersion:  mapStr(m, "protocolVersion"),
		ServerType:       mapStr(m, "serverType"),
		ExportPathSource: mapStr(m, "exportPathSource"),
	}
}

// mapToPreCheckWorkerTaskPaths converts a map[string]interface{} into a typed
// PreCheckWorkerTaskPaths.
func mapToPreCheckWorkerTaskPaths(m map[string]interface{}) PreCheckWorkerTaskPaths {
	p := PreCheckWorkerTaskPaths{
		PathID:   mapStr(m, "pathId"),
		ServerID: mapStr(m, "serverId"),
		PathName: mapStr(m, "pathName"),
	}
	if v, ok := m["isSource"].(bool); ok {
		p.IsSource = v
	}
	if v, ok := m["discoveredSize"]; ok && v != nil {
		switch ds := v.(type) {
		case float64:
			i := int64(ds)
			p.DiscoveredSize = &i
		case json.Number:
			if i, err := ds.Int64(); err == nil {
				p.DiscoveredSize = &i
			}
		}
	}
	return p
}

// mapToPreCheckSettings converts a map[string]interface{} into a typed
// PreCheckSettings.
func mapToPreCheckSettings(v interface{}) PreCheckSettings {
	if v == nil {
		return PreCheckSettings{}
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return PreCheckSettings{}
	}
	s := PreCheckSettings{}
	if pat, ok := m["preserveAccessTime"].(bool); ok {
		s.PreserveAccessTime = pat
	}
	return s
}

// mapStr extracts a string value from a map, returning "" if not present.
func mapStr(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}
