package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all worker configuration values, read from environment variables
// with sensible defaults matching the TypeScript worker service.
type Config struct {
	WorkerID              string
	BuildID               string
	BaseWorkingPath       string
	TemporalAddress       string
	ConfigServiceURL      string
	ReportServiceURL      string
	JobServiceURL         string
	MaxRetryCount         int
	MaxMigrationCommand   int
	MaxScanCommand        int
	MaxCommandConcurrency int
	MaxWriteConcurrency   int
	ThreadCount           int
	ThreadBands           string
	MaxBufferSize         int
	HealthCheckInterval   int
	RedisMemThreshold     int
	OtelEndpoint          string
	CommandsInTask        int
	MaxCmdsInStream       int
	MetaToleranceMs       int
	MigrationTaskLimit    int
	RedisStreamGroupSize  int
	OperationTimeout      int
	ShutdownForceTime     string
	MaxActivityConcurrency int

	// Keycloak / auth
	KeycloakBaseURL string
	KeycloakRealm   string
	WorkerSecret    string

	// Speed test
	SpeedTestFileName   string
	SpeedTestFileSizeGB float64
	SpeedTestTimeout    int

	// Temporal TLS / JWT
	TemporalTLSEnabled    bool
	TemporalTLSCACert     string
	TemporalTLSServerName string
	TemporalJWTEnabled    bool

	// Pre-check
	CheckAvailableDiskSpace bool

	// Metrics
	VersionsPath string

	// Network
	ControlPlaneIP string

	// Redis
	RedisHost     string
	RedisPort     string
	RedisUsername string
	RedisPassword string
}

// Load reads configuration from environment variables, applying defaults where
// appropriate. It returns an error if a numeric environment variable contains a
// value that cannot be parsed.
func Load() (*Config, error) {
	speedTestSize, err := envOrDefaultFloat64("SPEED_TEST_FILE_SIZE_GB", 1.0)
	if err != nil {
		return nil, fmt.Errorf("parsing SPEED_TEST_FILE_SIZE_GB: %w", err)
	}

	maxRetryCount, err := envOrDefaultInt("MAX_OPERATION_RETRY", 3)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_OPERATION_RETRY: %w", err)
	}

	maxMigrationCommand, err := envOrDefaultInt("MAX_MIGRATION_COMMAND", 100)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_MIGRATION_COMMAND: %w", err)
	}

	maxScanCommand, err := envOrDefaultInt("MAX_SCAN_COMMAND", 500)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_SCAN_COMMAND: %w", err)
	}

	maxCommandConcurrency, err := envOrDefaultInt("MAX_COMMAND_CONCURRENCY", 100)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_COMMAND_CONCURRENCY: %w", err)
	}

	maxWriteConcurrency, err := envOrDefaultInt("MAX_WRITE_CONCURRENCY", 100)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_WRITE_CONCURRENCY: %w", err)
	}

	threadCount, err := envOrDefaultInt("THREAD_COUNT", 5)
	if err != nil {
		return nil, fmt.Errorf("parsing THREAD_COUNT: %w", err)
	}

	maxBufferSize, err := envOrDefaultInt("MAX_BUFFER_SIZE", 1048576)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_BUFFER_SIZE: %w", err)
	}

	healthCheckInterval, err := envOrDefaultInt("HEALTH_CHECK_INTERVAL", 5)
	if err != nil {
		return nil, fmt.Errorf("parsing HEALTH_CHECK_INTERVAL: %w", err)
	}

	redisMemThreshold, err := envOrDefaultInt("REDIS_MEM_USAGE_THRESHOLD", 90)
	if err != nil {
		return nil, fmt.Errorf("parsing REDIS_MEM_USAGE_THRESHOLD: %w", err)
	}

	commandsInTask, err := envOrDefaultInt("COMMANDS_IN_TASK", 100)
	if err != nil {
		return nil, fmt.Errorf("parsing COMMANDS_IN_TASK: %w", err)
	}

	maxCmdsInStream, err := envOrDefaultInt("MAX_CMDS_IN_STREAM", 5000)
	if err != nil {
		return nil, fmt.Errorf("parsing MAX_CMDS_IN_STREAM: %w", err)
	}

	metaToleranceMs, err := envOrDefaultInt("META_UPDATED_TOLERANCE_MS", 30000)
	if err != nil {
		return nil, fmt.Errorf("parsing META_UPDATED_TOLERANCE_MS: %w", err)
	}

	migrationTaskLimit, err := envOrDefaultInt("MIGRATION_TASK_LIMIT", 100)
	if err != nil {
		return nil, fmt.Errorf("parsing MIGRATION_TASK_LIMIT: %w", err)
	}

	redisStreamGroupSize, err := envOrDefaultInt("REDIS_STREAM_GROUP_SIZE", 1000)
	if err != nil {
		return nil, fmt.Errorf("parsing REDIS_STREAM_GROUP_SIZE: %w", err)
	}

	operationTimeout, err := envOrDefaultInt("OPERATION_TIMEOUT", 5000)
	if err != nil {
		return nil, fmt.Errorf("parsing OPERATION_TIMEOUT: %w", err)
	}

	maxActivityConcurrency, err := envOrDefaultInt("JOB_TASK_ACTIVITY_CONCURRENCY", 1)
	if err != nil {
		return nil, fmt.Errorf("parsing JOB_TASK_ACTIVITY_CONCURRENCY: %w", err)
	}

	speedTestTimeout, err := envOrDefaultInt("SPEED_TEST_TIMEOUT", 120000)
	if err != nil {
		return nil, fmt.Errorf("parsing SPEED_TEST_TIMEOUT: %w", err)
	}

	cfg := &Config{
		WorkerID:              envOrDefault("WORKER_ID", ""),
		BuildID:               envOrDefault("BUILD_ID", "1.0.0"),
		BaseWorkingPath:       envOrDefault("BASE_WORKING_PATH", "/mnt/datamigrate"),
		TemporalAddress:       envOrDefault("TEMPORAL_ADDRESS", "localhost:7233"),
		ConfigServiceURL:      envOrDefault("WORKER_CONFIG_URL", "http://localhost:3002"),
		ReportServiceURL:      envOrDefault("WORKER_REPORT_SERVICE_URL", "http://localhost:3003"),
		JobServiceURL:         envOrDefault("WORKER_JOB_SERVICE_URL", "http://localhost:3006"),
		MaxRetryCount:         maxRetryCount,
		MaxMigrationCommand:   maxMigrationCommand,
		MaxScanCommand:        maxScanCommand,
		MaxCommandConcurrency: maxCommandConcurrency,
		MaxWriteConcurrency:   maxWriteConcurrency,
		ThreadCount:           threadCount,
		ThreadBands:           envOrDefault("THREAD_BANDS", "1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1"),
		MaxBufferSize:         maxBufferSize,
		HealthCheckInterval:   healthCheckInterval,
		RedisMemThreshold:     redisMemThreshold,
		OtelEndpoint:          envOrDefault("OTEL_COLLECTOR_ENDPOINT", "localhost:4318"),
		CommandsInTask:        commandsInTask,
		MaxCmdsInStream:       maxCmdsInStream,
		MetaToleranceMs:       metaToleranceMs,
		MigrationTaskLimit:    migrationTaskLimit,
		RedisStreamGroupSize:  redisStreamGroupSize,
		OperationTimeout:      operationTimeout,
		ShutdownForceTime:     envOrDefault("WORKER_SHUTDOWN_FORCE_TIME", "10s"),
		MaxActivityConcurrency: maxActivityConcurrency,

		KeycloakBaseURL: envOrDefault("KEYCLOAK_BASE_URL", ""),
		KeycloakRealm:   envOrDefault("KEYCLOAK_REALM", ""),
		WorkerSecret:    envOrDefault("WORKER_SECRET", ""),

		SpeedTestFileName:   envOrDefault("SPEED_TEST_FILE_NAME", "1GB_zero_file.bin"),
		SpeedTestFileSizeGB: speedTestSize,
		SpeedTestTimeout:    speedTestTimeout,

		TemporalTLSEnabled:    envOrDefault("TEMPORAL_TLS_ENABLED", "false") == "true",
		TemporalTLSCACert:     envOrDefault("TEMPORAL_TLS_CA_CERT", ""),
		TemporalTLSServerName: envOrDefault("TEMPORAL_TLS_SERVER_NAME", ""),
		TemporalJWTEnabled:    envOrDefault("TEMPORAL_JWT_ENABLED", "false") == "true",

		CheckAvailableDiskSpace: envOrDefault("CHECK_AVAILABLE_DISK_SPACE", "false") == "true",
		VersionsPath:            envOrDefault("VERSIONS_PATH_LINUX", "/opt/datamigrator/conf/versions.conf"),

		ControlPlaneIP: envOrDefault("CONTROL_PLANE_IP", ""),

		RedisHost:     envOrDefault("REDIS_HOST", "127.0.0.1"),
		RedisPort:     envOrDefault("REDIS_PORT", "6379"),
		RedisUsername: envOrDefault("REDIS_USERNAME", ""),
		RedisPassword: envOrDefault("REDIS_PASSWORD", ""),
	}

	return cfg, nil
}

// envOrDefault returns the value of the environment variable identified by key,
// or defaultVal when the variable is unset or empty.
func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// envOrDefaultInt returns the integer value of the environment variable
// identified by key, or defaultVal when the variable is unset or empty. It
// returns an error if the variable is set but cannot be parsed as an integer.
func envOrDefaultInt(key string, defaultVal int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal, nil
	}
	parsed, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid integer value %q for %s: %w", v, key, err)
	}
	return parsed, nil
}

// envOrDefaultFloat64 returns the float64 value of the environment variable
// identified by key, or defaultVal when the variable is unset or empty. It
// returns an error if the variable is set but cannot be parsed as a float.
func envOrDefaultFloat64(key string, defaultVal float64) (float64, error) {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal, nil
	}
	parsed, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid float value %q for %s: %w", v, key, err)
	}
	return parsed, nil
}
