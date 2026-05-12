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
