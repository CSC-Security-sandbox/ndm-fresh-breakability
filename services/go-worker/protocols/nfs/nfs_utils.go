package nfs

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"syscall"
)

// HandleConnectionError maps OS-level error codes to user-friendly error
// messages. It inspects the underlying syscall.Errno or net.OpError and
// returns a descriptive string for common failure modes:
//
//	ENOTFOUND      - host not found (DNS)
//	EHOSTUNREACH   - host unreachable
//	ECONNREFUSED   - connection refused
//	ETIMEDOUT      - connection timed out
//	EACCES         - permission denied
//	ECONNRESET     - connection reset
//	ENETUNREACH    - network unreachable
func HandleConnectionError(err error) error {
	if err == nil {
		return nil
	}

	// Attempt to extract the hostname and port from a net.OpError for
	// richer error messages.
	host := "host"
	port := 2049

	var opErr *net.OpError
	if errors.As(err, &opErr) {
		if addr := opErr.Addr; addr != nil {
			host = addr.String()
		} else if opErr.Source != nil {
			host = opErr.Source.String()
		}
	}

	portStr := fmt.Sprintf("%d", port)

	// Match against known errno values.
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.EACCES:
			return fmt.Errorf("Error: Permission denied to access %s:%s", host, portStr)
		case syscall.ECONNREFUSED:
			return fmt.Errorf("Error: Connection refused by server at %s:%s", host, portStr)
		case syscall.ECONNRESET:
			return fmt.Errorf("Error: Connection reset by server at %s:%s", host, portStr)
		case syscall.EHOSTUNREACH:
			return fmt.Errorf("Error: Host %s unreachable", host)
		case syscall.ENETUNREACH:
			return fmt.Errorf("Error: Network unreachable for %s:%s", host, portStr)
		case syscall.ETIMEDOUT:
			return fmt.Errorf("Error: Connection to %s:%s timed out", host, portStr)
		}
	}

	// String-based heuristics for error messages that don't carry a
	// well-typed errno (e.g. "no such host" from the resolver).
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no such host"):
		return fmt.Errorf("Error: Host %s not found", host)
	case strings.Contains(msg, "host is unreachable") || strings.Contains(msg, "host unreachable"):
		return fmt.Errorf("Error: Host %s unreachable", host)
	case strings.Contains(msg, "connection refused"):
		return fmt.Errorf("Error: Connection refused by server at %s:%s", host, portStr)
	case strings.Contains(msg, "timed out") || strings.Contains(msg, "timeout"):
		return fmt.Errorf("Error: Connection to %s:%s timed out", host, portStr)
	case strings.Contains(msg, "permission denied"):
		return fmt.Errorf("Error: Permission denied to access %s:%s", host, portStr)
	case strings.Contains(msg, "connection reset"):
		return fmt.Errorf("Error: Connection reset by server at %s:%s", host, portStr)
	case strings.Contains(msg, "network is unreachable") || strings.Contains(msg, "network unreachable"):
		return fmt.Errorf("Error: Network unreachable for %s:%s", host, portStr)
	case strings.Contains(msg, "port") && (strings.Contains(msg, "blocked") || strings.Contains(msg, "filtered")):
		return fmt.Errorf("Error: Protocol port %s is blocked or not accessible on %s", portStr, host)
	}

	return fmt.Errorf("Error: Unexpected error while connecting to %s:%s - %s", host, portStr, msg)
}

// ParseExports parses the output of "showmount -e <host>" and returns the
// exported paths. Only lines that begin with '/' are considered; the first
// whitespace-delimited token on each such line is treated as the export path.
// The root export "/" is excluded.
func ParseExports(output string) []string {
	if output == "" {
		return nil
	}

	var exports []string
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "/") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) == 0 {
			continue
		}
		path := fields[0]
		if path == "/" {
			continue
		}
		exports = append(exports, path)
	}
	return exports
}

// ParseProtocolVersions parses rpcinfo or similar version-listing output and
// returns the NFS protocol version numbers found. It looks for lines ending in
// "nfs" and extracts the version token.
func ParseProtocolVersions(output string) []string {
	if output == "" {
		return nil
	}

	var versions []string
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasSuffix(trimmed, "nfs") {
			continue
		}
		tokens := strings.Fields(trimmed)
		if len(tokens) < 2 {
			continue
		}
		versions = append(versions, tokens[1])
	}
	return versions
}

// readFstab reads /etc/fstab (or any path) and returns its content.
func readFstab(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read %s: %w", path, err)
	}
	return string(data), nil
}

// writeFstab atomically writes content to the given fstab path.
func writeFstab(path, content string) error {
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}
	return nil
}
