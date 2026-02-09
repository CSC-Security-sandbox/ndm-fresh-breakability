package smb

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
	"github.com/netapp/ndm/services/go-worker/protocols"
)

const (
	defaultCmdTimeout = 30 // seconds
)

// SMBProtocol implements protocols.Protocol for the SMB/CIFS file-sharing
// protocol on Linux. It delegates to mount.cifs and smbclient via shell
// commands whose patterns are read from environment-variable-based config.
type SMBProtocol struct {
	cfg *config.Config
	log *logger.Logger
}

// NewSMBProtocol returns a ready-to-use SMB protocol handler.
func NewSMBProtocol(cfg *config.Config, log *logger.Logger) *SMBProtocol {
	return &SMBProtocol{
		cfg: cfg,
		log: log,
	}
}

func init() {
	protocols.RegisterProtocol("SMB", func(cfg *config.Config, log *logger.Logger) protocols.Protocol {
		return NewSMBProtocol(cfg, log)
	})
}

// --------------------------------------------------------------------------
// Protocol interface implementation
// --------------------------------------------------------------------------

// ValidateConnection verifies that the credentials are accepted by the SMB
// server. If a dedicated validateCred command pattern is configured it is
// executed directly; otherwise a mount/unmount round-trip is performed.
func (s *SMBProtocol) ValidateConnection(traceID string, payload protocols.ProtocolPayload) error {
	s.log.Info("validating SMB connection",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	pattern := config.GetSMBCommand(config.PatternValidateCred)
	if pattern != "" {
		_, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, s.log)
		if err != nil {
			return fmt.Errorf("SMB validate connection failed: %w", err)
		}
		return nil
	}

	// Fallback: attempt a mount then unmount to prove credentials work.
	if err := s.MountPath(traceID, payload, false); err != nil {
		return fmt.Errorf("SMB validate connection (mount fallback) failed: %w", err)
	}
	if err := s.UnmountPath(traceID, payload, false); err != nil {
		s.log.Warn("SMB validate connection unmount cleanup failed",
			zap.String("traceID", traceID),
			zap.Error(err),
		)
	}
	return nil
}

// ListPaths executes smbclient -L against the host and returns the available
// share names. Each share name is prefixed with "/" (e.g. "/myshare").
func (s *SMBProtocol) ListPaths(traceID string, payload protocols.ProtocolPayload) ([]string, error) {
	s.log.Info("listing SMB shares",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	pattern := config.GetSMBCommand(config.PatternListPaths)
	if pattern == "" {
		return nil, fmt.Errorf("SMB listPath command pattern is not configured")
	}

	output, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, s.log)
	if err != nil {
		errMsg := err.Error()
		match := regexp.MustCompile(`NT_STATUS_[A-Z_]+`).FindString(errMsg)
		if match != "" {
			return nil, fmt.Errorf("%s", handleConnectionError(match))
		}
		return nil, fmt.Errorf("SMB list paths failed: %w", err)
	}

	shares := parseLinuxShares(output)
	s.log.Info("SMB shares listed",
		zap.String("traceID", traceID),
		zap.Int("count", len(shares)),
	)
	return shares, nil
}

// MountPath creates the local mount directory and mounts the remote SMB share
// using mount.cifs. On Linux no credential-save or privilege escalation is
// needed.
func (s *SMBProtocol) MountPath(traceID string, payload protocols.ProtocolPayload, manageMount bool) error {
	s.log.Info("mounting SMB path",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	mountDir := protocols.GetMountDir(payload)

	if err := os.MkdirAll(mountDir, 0755); err != nil {
		return fmt.Errorf("failed to create mount directory %s: %w", mountDir, err)
	}
	s.log.Debug("mount directory created", zap.String("mountDir", mountDir))

	pattern := config.GetSMBCommand(config.PatternMountPath)
	if pattern == "" {
		return fmt.Errorf("SMB mountPath command pattern is not configured")
	}

	_, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, s.log)
	if err != nil {
		return fmt.Errorf("SMB mount failed for %s: %w", payload.Hostname, err)
	}

	s.log.Info("SMB path mounted",
		zap.String("traceID", traceID),
		zap.String("mountDir", mountDir),
	)
	return nil
}

// UnmountPath unmounts the SMB share and removes the local mount directory.
func (s *SMBProtocol) UnmountPath(traceID string, payload protocols.ProtocolPayload, manageMount bool) error {
	s.log.Info("unmounting SMB path",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	pattern := config.GetSMBCommand(config.PatternUnmountPath)
	if pattern == "" {
		return fmt.Errorf("SMB unmountPath command pattern is not configured")
	}

	_, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, s.log)
	if err != nil {
		return fmt.Errorf("SMB unmount failed: %w", err)
	}

	mountDir := protocols.GetMountDir(payload)
	if mountDir != "" && strings.HasPrefix(mountDir, payload.MountBasePath) {
		if removeErr := os.RemoveAll(mountDir); removeErr != nil {
			s.log.Warn("failed to remove mount directory",
				zap.String("traceID", traceID),
				zap.String("mountDir", mountDir),
				zap.Error(removeErr),
			)
		} else {
			s.log.Info("mount directory removed",
				zap.String("traceID", traceID),
				zap.String("mountDir", mountDir),
			)
		}
	}
	return nil
}

// GetAvailableDiskSpace executes the configured availableDiskSpace command and
// returns the result in bytes.
func (s *SMBProtocol) GetAvailableDiskSpace(traceID string, payload protocols.ProtocolPayload) (int64, error) {
	s.log.Info("checking SMB available disk space",
		zap.String("traceID", traceID),
		zap.String("path", payload.Path),
	)

	pattern := config.GetSMBCommand(config.PatternAvailableDiskSpace)
	if pattern == "" {
		return 0, fmt.Errorf("SMB availableDiskSpace command pattern is not configured")
	}

	output, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, s.log)
	if err != nil {
		return 0, fmt.Errorf("failed to get available disk space at %s: %w", payload.Path, err)
	}

	available, parseErr := strconv.ParseInt(strings.TrimSpace(output), 10, 64)
	if parseErr != nil {
		return 0, fmt.Errorf("failed to parse available disk space output %q: %w", output, parseErr)
	}

	s.log.Info("SMB available disk space",
		zap.String("traceID", traceID),
		zap.Int64("bytes", available),
	)
	return available, nil
}

// GetTotalUsedMemory executes the configured mountedFolderSize command (df)
// and returns the used bytes.
func (s *SMBProtocol) GetTotalUsedMemory(traceID string, payload protocols.ProtocolPayload) (int64, error) {
	s.log.Info("checking SMB used memory",
		zap.String("traceID", traceID),
		zap.String("path", payload.Path),
	)

	pattern := config.GetSMBCommand(config.PatternMountedFolderSize)
	if pattern == "" {
		return 0, fmt.Errorf("SMB mountedFolderSize command pattern is not configured")
	}

	output, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, s.log)
	if err != nil {
		return 0, fmt.Errorf("failed to calculate size for %s: %w", payload.Path, err)
	}

	used, parseErr := strconv.ParseInt(strings.TrimSpace(output), 10, 64)
	if parseErr != nil {
		return 0, fmt.Errorf("failed to parse used memory output %q: %w", output, parseErr)
	}

	s.log.Info("SMB total used memory",
		zap.String("traceID", traceID),
		zap.Int64("bytes", used),
	)
	return used, nil
}

// --------------------------------------------------------------------------
// SMB-specific helpers
// --------------------------------------------------------------------------

// parseLinuxShares parses the output of smbclient -L and returns share names
// prefixed with "/". It looks for lines in the tabular section that contain
// "Disk" as the share type and filters out special shares (IPC$, print$, etc.).
func parseLinuxShares(output string) []string {
	lines := strings.Split(output, "\n")
	var shares []string
	startParsing := false

	irrelevant := regexp.MustCompile(`(?i)^(IPC\$|print\$|SMB\d)$|.*\$$`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "Sharename") {
			startParsing = true
			continue
		}

		if startParsing && (strings.HasPrefix(trimmed, "---------") || trimmed == "") {
			continue
		}

		if startParsing {
			cols := strings.Fields(trimmed)
			if len(cols) >= 2 {
				shareName := cols[0]
				shareType := cols[1]

				// Only include "Disk" type shares that are not system shares.
				if strings.EqualFold(shareType, "Disk") && !irrelevant.MatchString(shareName) {
					shares = append(shares, "/"+shareName)
				}
			}
		}
	}
	return shares
}

// handleConnectionError maps NT_STATUS error codes from smbclient to
// user-friendly error messages.
func handleConnectionError(errorCode string) string {
	switch errorCode {
	case "NT_STATUS_ACCESS_DENIED":
		return fmt.Sprintf("Error: Unable to connect to the server - %s", errorCode)
	case "NT_STATUS_CONNECTION_REFUSED":
		return fmt.Sprintf("Error: Not a valid SMB server - %s", errorCode)
	case "NT_STATUS_LOGON_FAILURE":
		return fmt.Sprintf("Error: Wrong credentials - %s", errorCode)
	case "NT_STATUS_IO_TIMEOUT":
		return fmt.Sprintf("Unable to connect to the server - %s", errorCode)
	case "NT_STATUS_INVALID_NETWORK_RESPONSE":
		return fmt.Sprintf("Error: Protocol not supported by server - %s", errorCode)
	case "NT_STATUS_NETWORK_UNREACHABLE":
		return fmt.Sprintf("Error: Network unreachable - %s", errorCode)
	case "NT_STATUS_HOST_UNREACHABLE":
		return fmt.Sprintf("Error: Host unreachable - %s", errorCode)
	case "NT_STATUS_PORT_UNREACHABLE":
		return fmt.Sprintf("Error: Protocol port blocked or not accessible - %s", errorCode)
	default:
		return fmt.Sprintf("Unable to connect to the server - %s", errorCode)
	}
}
