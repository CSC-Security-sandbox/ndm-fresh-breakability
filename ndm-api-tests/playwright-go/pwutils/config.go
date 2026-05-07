package pwutils

import (
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	BaseURL                string
	User                   string
	Password               string
	SourceHost             string
	Protocol               string
	ProtocolUsername        string
	ProtocolPassword       string
	SourceExportPaths      []string
	DestinationHost        string
	DestProtocolUsername    string
	DestProtocolPassword   string
	DestinationExportPaths []string
	MaxDiscoveryPaths      int
	MinWorkers             int
	ScheduleDelaySec       int
}

var BaseURL string

func MustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("Missing required env var: %s", key)
	}
	return v
}

func LoadConfig() Config {
	for _, p := range []string{".env", filepath.Join("..", ".env"), filepath.Join("..", "playwright-test", ".env")} {
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Load(p)
			break
		}
	}

	protocol := os.Getenv("PROTOCOL")
	if protocol == "" {
		protocol = "NFS"
	}

	split := func(s string) []string {
		if s == "" {
			return nil
		}
		var out []string
		for _, p := range strings.Split(s, ",") {
			out = append(out, strings.TrimSpace(p))
		}
		return out
	}

	maxPaths := 5
	if v := os.Getenv("MAX_DISCOVERY_PATHS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxPaths = n
		}
	}

	minWorkers := 2
	if v := os.Getenv("MIN_WORKERS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			minWorkers = n
		}
	}

	schedDelay := 90
	if v := os.Getenv("SCHEDULE_DELAY_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			schedDelay = n
		}
	}

	cfg := Config{
		BaseURL:                MustEnv("BASE_URL"),
		User:                   os.Getenv("NDM_TEST_USER"),
		Password:               os.Getenv("NDM_TEST_PASSWORD"),
		SourceHost:             MustEnv("SOURCE_HOST"),
		Protocol:               protocol,
		ProtocolUsername:        MustEnv("PROTOCOL_USERNAME"),
		ProtocolPassword:       os.Getenv("PROTOCOL_PASSWORD"),
		SourceExportPaths:      split(os.Getenv("SOURCE_EXPORT_PATHS")),
		DestinationHost:        os.Getenv("DESTINATION_HOST"),
		DestProtocolUsername:    os.Getenv("DESTINATION_PROTOCOL_USERNAME"),
		DestProtocolPassword:   os.Getenv("DESTINATION_PROTOCOL_PASSWORD"),
		DestinationExportPaths: split(os.Getenv("DESTINATION_EXPORT_PATHS")),
		MaxDiscoveryPaths:      maxPaths,
		MinWorkers:             minWorkers,
		ScheduleDelaySec:       schedDelay,
	}

	BaseURL = cfg.BaseURL
	return cfg
}

func FullURL(path string) string {
	if strings.HasPrefix(path, "http") {
		return path
	}
	return strings.TrimRight(BaseURL, "/") + path
}
