package protocols

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// ProtocolPayload carries the parameters needed by every protocol operation
// (validate, mount, unmount, list, disk-space, etc.).
type ProtocolPayload struct {
	Hostname        string
	Username        string
	Password        string
	Path            string
	MountBasePath   string
	JobRunID        string
	PathID          string
	ProtocolVersion string
	DirPath         string
}

// Protocol defines the operations that every file-server protocol handler must
// implement. Each method receives a traceID for correlation in log output.
type Protocol interface {
	ValidateConnection(traceID string, payload ProtocolPayload) error
	ListPaths(traceID string, payload ProtocolPayload) ([]string, error)
	MountPath(traceID string, payload ProtocolPayload, manageMount bool) error
	UnmountPath(traceID string, payload ProtocolPayload, manageMount bool) error
	GetAvailableDiskSpace(traceID string, payload ProtocolPayload) (int64, error)
	GetTotalUsedMemory(traceID string, payload ProtocolPayload) (int64, error)
}

// ProtocolFactory is a constructor function that creates a Protocol instance.
type ProtocolFactory func(cfg *config.Config, log *logger.Logger) Protocol

var (
	factoryMu  sync.RWMutex
	factoryMap = make(map[string]ProtocolFactory)
)

// RegisterProtocol allows sub-packages (smb, nfs) to register their factory
// functions during init(). The name is stored in upper-case.
func RegisterProtocol(name string, factory ProtocolFactory) {
	factoryMu.Lock()
	defer factoryMu.Unlock()
	factoryMap[strings.ToUpper(name)] = factory
}

// NewProtocol creates the appropriate protocol handler based on protocolType.
// Recognised values (case-insensitive) are "SMB" and "NFS". An unrecognised
// protocol type returns nil and logs an error.
func NewProtocol(protocolType string, cfg *config.Config, log *logger.Logger) Protocol {
	factoryMu.RLock()
	factory, ok := factoryMap[strings.ToUpper(protocolType)]
	factoryMu.RUnlock()

	if !ok {
		log.Error("unsupported protocol type", zap.String("protocolType", protocolType))
		return nil
	}
	return factory(cfg, log)
}

// ExecuteCommand substitutes placeholders in a command pattern, logs the
// sanitized form, and executes the resulting shell command with a timeout.
//
// Placeholders replaced: ${HOST}, ${USERNAME}, ${PASSWORD}, ${MOUNT_PATH},
// ${DIR_PATH}, ${PROTOCOL_VERSION}, ${PATH}.
//
// On success the captured stdout is returned. On failure an error wrapping the
// stderr output is returned. Credentials are never written to logs.
func ExecuteCommand(pattern string, payload ProtocolPayload, timeoutSeconds int, log *logger.Logger) (string, error) {
	command := SubstitutePlaceholders(pattern, payload)

	sanitized := SanitizeCommand(command, payload)
	log.Debug("executing command", zap.String("command", sanitized))

	if timeoutSeconds <= 0 {
		timeoutSeconds = 5
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		stderrText := strings.TrimSpace(stderr.String())
		if stderrText == "" {
			stderrText = err.Error()
		}
		sanitizedErr := SanitizeCommand(stderrText, payload)
		log.Error("command failed",
			zap.String("command", sanitized),
			zap.String("error", sanitizedErr),
		)
		return "", fmt.Errorf("%s", sanitizedErr)
	}

	result := strings.TrimSpace(stdout.String())
	log.Info("command succeeded",
		zap.String("command", sanitized),
		zap.String("stdout", result),
	)
	return result, nil
}

// SanitizeCommand replaces sensitive credential values (username and password)
// with "******" so that log output never exposes secrets.
func SanitizeCommand(cmd string, payload ProtocolPayload) string {
	sanitized := cmd
	if trimmed := strings.TrimSpace(payload.Password); trimmed != "" {
		sanitized = strings.ReplaceAll(sanitized, trimmed, "******")
	}
	if trimmed := strings.TrimSpace(payload.Username); trimmed != "" {
		sanitized = strings.ReplaceAll(sanitized, trimmed, "******")
	}
	return sanitized
}

// SubstitutePlaceholders replaces all ${...} placeholder tokens in pattern
// with the corresponding values from payload.
func SubstitutePlaceholders(pattern string, payload ProtocolPayload) string {
	mountDir := GetMountDir(payload)

	r := strings.NewReplacer(
		"${HOST}", payload.Hostname,
		"${USERNAME}", payload.Username,
		"${PASSWORD}", payload.Password,
		"${MOUNT_PATH}", payload.Path,
		"${DIR_PATH}", mountDir,
		"${PROTOCOL_VERSION}", payload.ProtocolVersion,
		"${PATH}", payload.Path,
	)
	return r.Replace(pattern)
}

// GetMountDir returns the mount directory path computed from the payload:
//
//	{MountBasePath}/{JobRunID}/{PathID}
func GetMountDir(payload ProtocolPayload) string {
	return filepath.Join(payload.MountBasePath, payload.JobRunID, payload.PathID)
}
