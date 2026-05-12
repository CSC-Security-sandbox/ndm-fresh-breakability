// Package config loads NDM UI test configuration from a .env file and
// environment variables. Environment variables always take precedence over
// values defined in .env so CI pipelines can override without editing files.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// ── Exported config vars ──────────────────────────────────────────────────────

var (
	// Control Plane
	BaseURL string

	// Default App Admin login
	Username string
	Password string

	// Browser settings
	Headless      bool
	SlowMo        float64
	Timeout       float64
	VideoDir      string
	ScreenshotDir string

	// File server creation (when NDM_FILE_SERVER_ID is empty the test
	// creates one via the wizard using these values)
	SourceHost         string // IP/hostname of the NFS server
	ProtocolUsername   string // NFS user (e.g. "root")
	ProtocolPassword   string // NFS password (often empty)
	MinWorkers         int    // workers to associate (default: 1)
	FileServerNameNew  string // name for a newly created file server

	// SMB file server creation
	SMBHost       string // IP/hostname of the SMB server (e.g. "172.30.202.20")
	SMBAdServerIP string // AD Server IP for SMB authentication (e.g. "172.30.202.5")
	SMBUsername   string // SMB username (e.g. "DOMAIN\\user")
	SMBPassword   string // SMB password
	SMBShare      string // SMB share name to select in Bulk Discover (e.g. "master_smb_vol_dnd_src_automation_1")

	// Isilon file server creation
	IsilonHost         string // Management console IP (e.g. "10.192.7.105")
	IsilonMgmtUsername string // Management console username (e.g. "root")
	IsilonMgmtPassword string // Management console password
	IsilonNfsIP        string // NFS IP to select in Access Zone dropdown (e.g. "10.192.7.117")
	IsilonNfsUsername  string // NFS username for access zone (e.g. "root")

	// Discovery test configuration — IDs for existing file servers
	FileServerID            string // UUID of the primary file server config
	FileServerName          string // display name shown in the UI (configName)
	SMBFileServerID         string // UUID of an SMB file server (for test 5.2; auto-skips if empty)
	DestinationFileServerID string // UUID of the destination file server (for test 5.16; auto-skips if empty)
	IsilonFileServerID      string // UUID of an Isilon file server (for test 5.18; auto-skips if empty)
	NfsExportPath           string // NFS export path to select in the table (e.g. "/vol1")
	SmbShareName            string // SMB share name (for test 5.2; auto-skips if empty)

	// Discovery timeouts (overridable for slow environments)
	DiscoveryTimeoutMs float64 // max wait for a discovery run to complete
)

// init loads .env then reads every config var from the environment.
// env vars always win over .env values (CI-friendly).
func init() {
	// Locate .env relative to THIS source file so it works regardless of
	// which directory `go test` is invoked from.
	_, thisFile, _, _ := runtime.Caller(0)
	// thisFile = .../ndm-ui-tests/config/config.go
	// .env lives one level up: .../ndm-ui-tests/.env
	repoEnv := filepath.Join(filepath.Dir(thisFile), "..", ".env")
	loadDotEnv(repoEnv)    // absolute path — always works
	loadDotEnv("../.env")  // fallback: relative from test package dir
	loadDotEnv(".env")     // fallback: current working dir

	// Control Plane
	BaseURL = mustGetEnv("NDM_BASE_URL")

	// Credentials
	Username = mustGetEnv("NDM_USERNAME")
	Password = mustGetEnv("NDM_PASSWORD")

	// Browser
	Headless      = getEnvBool("NDM_HEADLESS", true)
	SlowMo        = getEnvFloat("NDM_SLOWMO", 0)
	Timeout       = getEnvFloat("NDM_TIMEOUT", 30000)
	VideoDir      = getEnvStr("NDM_VIDEO_DIR", "test-results/videos")
	ScreenshotDir = getEnvStr("NDM_SCREENSHOT_DIR", "test-results/screenshots")

	// File server creation
	SourceHost        = getEnvStr("NDM_SOURCE_HOST", "")
	ProtocolUsername  = getEnvStr("NDM_PROTOCOL_USERNAME", "root")
	ProtocolPassword  = getEnvStr("NDM_PROTOCOL_PASSWORD", "")
	MinWorkers        = getEnvInt("NDM_MIN_WORKERS", 1)
	FileServerNameNew = getEnvStr("NDM_FILE_SERVER_NAME_NEW", "auto-test-fs")

	// SMB file server creation
	SMBHost       = getEnvStr("NDM_SMB_HOST", "")
	SMBAdServerIP = getEnvStr("NDM_SMB_AD_SERVER_IP", "")
	SMBUsername   = getEnvStr("NDM_SMB_USERNAME", "")
	SMBPassword   = getEnvStr("NDM_SMB_PASSWORD", "")
	SMBShare    = getEnvStr("NDM_SMB_SHARE", "")

	// Isilon file server creation
	IsilonHost         = getEnvStr("NDM_ISILON_HOST", "")
	IsilonMgmtUsername = getEnvStr("NDM_ISILON_MGMT_USERNAME", "root")
	IsilonMgmtPassword = getEnvStr("NDM_ISILON_MGMT_PASSWORD", "")
	IsilonNfsIP        = getEnvStr("NDM_ISILON_NFS_IP", "")
	IsilonNfsUsername  = getEnvStr("NDM_ISILON_NFS_USERNAME", "root")

	// Discovery — existing file server IDs
	FileServerID            = getEnvStr("NDM_FILE_SERVER_ID", "")
	FileServerName          = getEnvStr("NDM_FILE_SERVER_NAME", "")
	SMBFileServerID         = getEnvStr("NDM_SMB_FILE_SERVER_ID", "")
	DestinationFileServerID = getEnvStr("NDM_DESTINATION_FILE_SERVER_ID", "")
	IsilonFileServerID      = getEnvStr("NDM_ISILON_FILE_SERVER_ID", "")
	NfsExportPath           = getEnvStr("NDM_NFS_EXPORT_PATH", "")
	SmbShareName            = getEnvStr("NDM_SMB_SHARE_NAME", "")
	DiscoveryTimeoutMs      = getEnvFloat("NDM_DISCOVERY_TIMEOUT_MS", 600000)
}

// ── .env loader ──────────────────────────────────────────────────────────────

// loadDotEnv reads key=value pairs from path and sets them in the process
// environment. Lines starting with # are ignored. Existing env vars are NOT
// overwritten (environment always wins).
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // .env is optional — no error if absent
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		// Strip inline comments (e.g. value  # comment)
		if idx := strings.Index(val, " #"); idx != -1 {
			val = strings.TrimSpace(val[:idx])
		}
		// Only set if not already present in environment
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// mustGetEnv returns the value of key or panics with a clear message so the
// developer knows exactly which .env entry is missing.
func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf(
			"[ndm-ui-tests] required config %q is not set.\n"+
				"  → copy .env.example to .env and fill in the value.", key))
	}
	return v
}

func getEnvStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	switch v {
	case "true", "1":
		return true
	case "false", "0":
		return false
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return i
}

func getEnvFloat(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return f
}
