package nfs

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
	"github.com/netapp/ndm/services/go-worker/protocols"
)

const (
	nfsPort           = 2049
	connectTimeout    = 2 * time.Second
	defaultCmdTimeout = 30 // seconds
	postMountDelay    = 5 * time.Second
	fstabPath         = "/etc/fstab"
)

// NFSProtocol implements protocols.Protocol for the NFS file-sharing protocol
// on Linux. Mount operations use the kernel NFS client; connection validation
// performs a raw TCP dial to the NFS port.
type NFSProtocol struct {
	cfg *config.Config
	log *logger.Logger
}

// NewNFSProtocol returns a ready-to-use NFS protocol handler.
func NewNFSProtocol(cfg *config.Config, log *logger.Logger) *NFSProtocol {
	return &NFSProtocol{
		cfg: cfg,
		log: log,
	}
}

func init() {
	protocols.RegisterProtocol("NFS", func(cfg *config.Config, log *logger.Logger) protocols.Protocol {
		return NewNFSProtocol(cfg, log)
	})
}

// --------------------------------------------------------------------------
// Protocol interface implementation
// --------------------------------------------------------------------------

// ValidateConnection performs a TCP socket connect to hostname:2049 with a 2-
// second timeout. A successful connect proves the NFS server is reachable and
// listening.
func (n *NFSProtocol) ValidateConnection(traceID string, payload protocols.ProtocolPayload) error {
	n.log.Info("validating NFS connection",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	addr := net.JoinHostPort(payload.Hostname, strconv.Itoa(nfsPort))
	conn, err := net.DialTimeout("tcp", addr, connectTimeout)
	if err != nil {
		n.log.Error("NFS connection validation failed",
			zap.String("traceID", traceID),
			zap.Error(err),
		)
		return HandleConnectionError(err)
	}
	conn.Close()

	n.log.Info("NFS connection established",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)
	return nil
}

// ListPaths executes "showmount -e" against the host and returns the exported
// paths.
func (n *NFSProtocol) ListPaths(traceID string, payload protocols.ProtocolPayload) ([]string, error) {
	n.log.Info("listing NFS exports",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	pattern := config.GetNFSCommand(config.PatternListPaths)
	if pattern == "" {
		return nil, fmt.Errorf("NFS listPath command pattern is not configured")
	}

	output, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, n.log)
	if err != nil {
		return nil, fmt.Errorf("NFS list paths failed: %w", err)
	}

	exports := ParseExports(output)
	n.log.Info("NFS exports listed",
		zap.String("traceID", traceID),
		zap.Int("count", len(exports)),
	)
	return exports, nil
}

// MountPath creates the local mount directory and mounts the remote NFS
// export. When manageMount is true the mount entry is appended to /etc/fstab
// so the mount persists across reboots. A 5-second delay is applied after
// mounting to allow the kernel NFS client to stabilise.
func (n *NFSProtocol) MountPath(traceID string, payload protocols.ProtocolPayload, manageMount bool) error {
	n.log.Info("mounting NFS path",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
		zap.String("path", payload.Path),
	)

	mountDir := protocols.GetMountDir(payload)

	if err := os.MkdirAll(mountDir, 0755); err != nil {
		return fmt.Errorf("failed to create mount directory %s: %w", mountDir, err)
	}
	n.log.Debug("mount directory created", zap.String("mountDir", mountDir))

	pattern := config.GetNFSCommand(config.PatternMountPath)
	if pattern == "" {
		return fmt.Errorf("NFS mountPath command pattern is not configured")
	}

	_, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, n.log)
	if err != nil {
		return fmt.Errorf("NFS mount failed for %s: %w", payload.Hostname, err)
	}

	if manageMount {
		if fErr := addFstabEntry(payload, mountDir, traceID, n.log); fErr != nil {
			n.log.Error("failed to add fstab entry",
				zap.String("traceID", traceID),
				zap.Error(fErr),
			)
			// Non-fatal: the mount succeeded even if fstab update failed.
		}
	}

	// Wait for the NFS client to stabilise after mounting.
	time.Sleep(postMountDelay)

	n.log.Info("NFS path mounted",
		zap.String("traceID", traceID),
		zap.String("mountDir", mountDir),
	)
	return nil
}

// UnmountPath unmounts the NFS export and removes the local mount directory.
// When manageMount is true the corresponding /etc/fstab entry is also removed.
func (n *NFSProtocol) UnmountPath(traceID string, payload protocols.ProtocolPayload, manageMount bool) error {
	n.log.Info("unmounting NFS path",
		zap.String("traceID", traceID),
		zap.String("hostname", payload.Hostname),
	)

	pattern := config.GetNFSCommand(config.PatternUnmountPath)
	if pattern == "" {
		return fmt.Errorf("NFS unmountPath command pattern is not configured")
	}

	_, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, n.log)
	if err != nil {
		return fmt.Errorf("NFS unmount failed: %w", err)
	}

	mountDir := protocols.GetMountDir(payload)
	if mountDir != "" && strings.HasPrefix(mountDir, payload.MountBasePath) {
		if removeErr := os.RemoveAll(mountDir); removeErr != nil {
			n.log.Warn("failed to remove mount directory",
				zap.String("traceID", traceID),
				zap.String("mountDir", mountDir),
				zap.Error(removeErr),
			)
		} else {
			n.log.Info("mount directory removed",
				zap.String("traceID", traceID),
				zap.String("mountDir", mountDir),
			)
		}
	}

	if manageMount {
		if fErr := removeFstabEntry(payload, mountDir, traceID, n.log); fErr != nil {
			n.log.Error("failed to remove fstab entry",
				zap.String("traceID", traceID),
				zap.Error(fErr),
			)
		}
	}

	return nil
}

// GetAvailableDiskSpace executes the configured availableDiskSpace command and
// returns the result in bytes.
func (n *NFSProtocol) GetAvailableDiskSpace(traceID string, payload protocols.ProtocolPayload) (int64, error) {
	n.log.Info("checking NFS available disk space",
		zap.String("traceID", traceID),
		zap.String("path", payload.Path),
	)

	pattern := config.GetNFSCommand(config.PatternAvailableDiskSpace)
	if pattern == "" {
		return 0, fmt.Errorf("NFS availableDiskSpace command pattern is not configured")
	}

	output, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, n.log)
	if err != nil {
		return 0, fmt.Errorf("failed to get available disk space at %s: %w", payload.Path, err)
	}

	available, parseErr := strconv.ParseInt(strings.TrimSpace(output), 10, 64)
	if parseErr != nil {
		return 0, fmt.Errorf("failed to parse available disk space output %q: %w", output, parseErr)
	}

	n.log.Info("NFS available disk space",
		zap.String("traceID", traceID),
		zap.Int64("bytes", available),
	)
	return available, nil
}

// GetTotalUsedMemory executes the configured mountedFolderSize command (df)
// and returns the used bytes. On Linux the df output is expected to use 1K
// blocks, so the raw value is multiplied by 1024 to produce bytes.
func (n *NFSProtocol) GetTotalUsedMemory(traceID string, payload protocols.ProtocolPayload) (int64, error) {
	n.log.Info("checking NFS used memory",
		zap.String("traceID", traceID),
		zap.String("path", payload.Path),
	)

	pattern := config.GetNFSCommand(config.PatternMountedFolderSize)
	if pattern == "" {
		return 0, fmt.Errorf("NFS mountedFolderSize command pattern is not configured")
	}

	output, err := protocols.ExecuteCommand(pattern, payload, defaultCmdTimeout, n.log)
	if err != nil {
		return 0, fmt.Errorf("failed to calculate size for %s: %w", payload.Path, err)
	}

	// The df command with --output=used or standard df output on Linux
	// typically produces space-separated columns:
	//   Filesystem   1K-blocks   Used   Available   Use%   Mounted on
	// We need the "Used" column (index 2) from the data line.
	parts := strings.Fields(strings.TrimSpace(output))
	if len(parts) < 3 {
		return 0, fmt.Errorf("unexpected df output: %s", output)
	}

	usedKB, parseErr := strconv.ParseInt(parts[2], 10, 64)
	if parseErr != nil {
		return 0, fmt.Errorf("failed to parse used memory value %q: %w", parts[2], parseErr)
	}

	// Linux df reports in 1K-blocks; convert to bytes.
	usedBytes := usedKB * 1024

	n.log.Info("NFS total used memory",
		zap.String("traceID", traceID),
		zap.Int64("bytes", usedBytes),
	)
	return usedBytes, nil
}

// --------------------------------------------------------------------------
// fstab management helpers
// --------------------------------------------------------------------------

// fstabEntry builds the fstab line for a given NFS mount.
func fstabEntry(payload protocols.ProtocolPayload, mountDir string) string {
	return fmt.Sprintf("%s:%s %s nfs defaults 0 0", payload.Hostname, payload.Path, mountDir)
}

// addFstabEntry appends an NFS mount entry to /etc/fstab if it does not
// already exist.
func addFstabEntry(payload protocols.ProtocolPayload, mountDir, traceID string, log *logger.Logger) error {
	fPath := resolveFstabPath()
	content, err := readFstab(fPath)
	if err != nil {
		return err
	}

	entry := fstabEntry(payload, mountDir)
	if strings.Contains(content, entry) {
		log.Info("fstab entry already exists",
			zap.String("traceID", traceID),
		)
		return nil
	}

	// Ensure the file ends with a newline before appending.
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += entry + "\n"

	if err := writeFstab(fPath, content); err != nil {
		return err
	}

	log.Info("added entry to fstab",
		zap.String("traceID", traceID),
		zap.String("fstabPath", fPath),
	)
	return nil
}

// removeFstabEntry removes the NFS mount entry from /etc/fstab.
func removeFstabEntry(payload protocols.ProtocolPayload, mountDir, traceID string, log *logger.Logger) error {
	fPath := resolveFstabPath()
	content, err := readFstab(fPath)
	if err != nil {
		return err
	}

	entry := fstabEntry(payload, mountDir)
	if !strings.Contains(content, entry) {
		log.Info("fstab entry not found, nothing to remove",
			zap.String("traceID", traceID),
		)
		return nil
	}

	lines := strings.Split(content, "\n")
	var filtered []string
	for _, line := range lines {
		if strings.TrimSpace(line) == strings.TrimSpace(entry) {
			continue
		}
		filtered = append(filtered, line)
	}

	newContent := strings.Join(filtered, "\n")
	// Preserve trailing newline if the original had one.
	if strings.HasSuffix(content, "\n") && len(newContent) > 0 && !strings.HasSuffix(newContent, "\n") {
		newContent += "\n"
	}

	if err := writeFstab(fPath, newContent); err != nil {
		return err
	}

	log.Info("removed entry from fstab",
		zap.String("traceID", traceID),
		zap.String("fstabPath", fPath),
	)
	return nil
}

// resolveFstabPath returns the fstab file path from the NFS config env var.
// If not configured, the default Linux path /etc/fstab is used.
func resolveFstabPath() string {
	path := config.GetNFSCommand(config.PatternFstabPath)
	if path != "" {
		return path
	}
	return fstabPath
}
