package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_DefaultValues(t *testing.T) {
	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "", cfg.WorkerID)
	assert.Equal(t, "1.0.0", cfg.BuildID)
	assert.Equal(t, "/mnt/datamigrate", cfg.BaseWorkingPath)
	assert.Equal(t, "localhost:7233", cfg.TemporalAddress)
	assert.Equal(t, "http://localhost:3002", cfg.ConfigServiceURL)
	assert.Equal(t, "http://localhost:3003", cfg.ReportServiceURL)
	assert.Equal(t, "http://localhost:3006", cfg.JobServiceURL)
	assert.Equal(t, 3, cfg.MaxRetryCount)
	assert.Equal(t, 100, cfg.MaxMigrationCommand)
	assert.Equal(t, 500, cfg.MaxScanCommand)
	assert.Equal(t, 100, cfg.MaxCommandConcurrency)
	assert.Equal(t, 100, cfg.MaxWriteConcurrency)
	assert.Equal(t, 5, cfg.ThreadCount)
	assert.Equal(t, "1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1", cfg.ThreadBands)
	assert.Equal(t, 1048576, cfg.MaxBufferSize)
	assert.Equal(t, 5, cfg.HealthCheckInterval)
	assert.Equal(t, 90, cfg.RedisMemThreshold)
	assert.Equal(t, "localhost:4318", cfg.OtelEndpoint)
	assert.Equal(t, 100, cfg.CommandsInTask)
	assert.Equal(t, 5000, cfg.MaxCmdsInStream)
	assert.Equal(t, 30000, cfg.MetaToleranceMs)
	assert.Equal(t, 100, cfg.MigrationTaskLimit)
	assert.Equal(t, 1000, cfg.RedisStreamGroupSize)
	assert.Equal(t, 5000, cfg.OperationTimeout)
	assert.Equal(t, "10s", cfg.ShutdownForceTime)
	assert.Equal(t, 1, cfg.MaxActivityConcurrency)

	assert.Equal(t, "", cfg.KeycloakBaseURL)
	assert.Equal(t, "", cfg.KeycloakRealm)
	assert.Equal(t, "", cfg.WorkerSecret)

	assert.Equal(t, "1GB_zero_file.bin", cfg.SpeedTestFileName)
	assert.Equal(t, 1.0, cfg.SpeedTestFileSizeGB)
	assert.Equal(t, 120000, cfg.SpeedTestTimeout)

	assert.False(t, cfg.TemporalTLSEnabled)
	assert.Equal(t, "", cfg.TemporalTLSCACert)
	assert.Equal(t, "", cfg.TemporalTLSServerName)
	assert.False(t, cfg.TemporalJWTEnabled)

	assert.False(t, cfg.CheckAvailableDiskSpace)
	assert.Equal(t, "/opt/datamigrator/conf/versions.conf", cfg.VersionsPath)

	assert.Equal(t, "", cfg.ControlPlaneIP)

	assert.Equal(t, "127.0.0.1", cfg.RedisHost)
	assert.Equal(t, "6379", cfg.RedisPort)
	assert.Equal(t, "", cfg.RedisUsername)
	assert.Equal(t, "", cfg.RedisPassword)
}

func TestLoad_OverrideEnvVars(t *testing.T) {
	t.Setenv("WORKER_ID", "test-worker-1")
	t.Setenv("BUILD_ID", "2.0.0")
	t.Setenv("BASE_WORKING_PATH", "/tmp/test")
	t.Setenv("TEMPORAL_ADDRESS", "temporal.example.com:7233")
	t.Setenv("MAX_OPERATION_RETRY", "10")
	t.Setenv("THREAD_COUNT", "8")
	t.Setenv("MAX_BUFFER_SIZE", "2097152")
	t.Setenv("SPEED_TEST_FILE_SIZE_GB", "2.5")
	t.Setenv("KEYCLOAK_BASE_URL", "https://keycloak.example.com")
	t.Setenv("KEYCLOAK_REALM", "test-realm")
	t.Setenv("WORKER_SECRET", "my-secret")
	t.Setenv("TEMPORAL_TLS_ENABLED", "true")
	t.Setenv("CHECK_AVAILABLE_DISK_SPACE", "true")
	t.Setenv("REDIS_HOST", "redis.example.com")
	t.Setenv("REDIS_PORT", "6380")
	t.Setenv("CONTROL_PLANE_IP", "10.0.0.1")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "test-worker-1", cfg.WorkerID)
	assert.Equal(t, "2.0.0", cfg.BuildID)
	assert.Equal(t, "/tmp/test", cfg.BaseWorkingPath)
	assert.Equal(t, "temporal.example.com:7233", cfg.TemporalAddress)
	assert.Equal(t, 10, cfg.MaxRetryCount)
	assert.Equal(t, 8, cfg.ThreadCount)
	assert.Equal(t, 2097152, cfg.MaxBufferSize)
	assert.Equal(t, 2.5, cfg.SpeedTestFileSizeGB)
	assert.Equal(t, "https://keycloak.example.com", cfg.KeycloakBaseURL)
	assert.Equal(t, "test-realm", cfg.KeycloakRealm)
	assert.Equal(t, "my-secret", cfg.WorkerSecret)
	assert.True(t, cfg.TemporalTLSEnabled)
	assert.True(t, cfg.CheckAvailableDiskSpace)
	assert.Equal(t, "redis.example.com", cfg.RedisHost)
	assert.Equal(t, "6380", cfg.RedisPort)
	assert.Equal(t, "10.0.0.1", cfg.ControlPlaneIP)
}

func TestLoad_InvalidIntegerEnvVar(t *testing.T) {
	t.Setenv("MAX_OPERATION_RETRY", "not-a-number")

	cfg, err := Load()
	assert.Nil(t, cfg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing MAX_OPERATION_RETRY")
}

func TestLoad_InvalidFloatEnvVar(t *testing.T) {
	t.Setenv("SPEED_TEST_FILE_SIZE_GB", "not-a-float")

	cfg, err := Load()
	assert.Nil(t, cfg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing SPEED_TEST_FILE_SIZE_GB")
}

func TestLoad_InvalidThreadCount(t *testing.T) {
	t.Setenv("THREAD_COUNT", "abc")

	cfg, err := Load()
	assert.Nil(t, cfg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing THREAD_COUNT")
}

func TestLoad_InvalidMaxBufferSize(t *testing.T) {
	t.Setenv("MAX_BUFFER_SIZE", "xyz")

	cfg, err := Load()
	assert.Nil(t, cfg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing MAX_BUFFER_SIZE")
}

func TestLoad_InvalidHealthCheckInterval(t *testing.T) {
	t.Setenv("HEALTH_CHECK_INTERVAL", "bad")

	cfg, err := Load()
	assert.Nil(t, cfg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing HEALTH_CHECK_INTERVAL")
}

func TestLoad_InvalidMaxMigrationCommand(t *testing.T) {
	t.Setenv("MAX_MIGRATION_COMMAND", "nope")

	cfg, err := Load()
	assert.Nil(t, cfg)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing MAX_MIGRATION_COMMAND")
}

func TestEnvOrDefault(t *testing.T) {
	// Returns default when env var is not set
	result := envOrDefault("TEST_NONEXISTENT_KEY_12345", "fallback")
	assert.Equal(t, "fallback", result)

	// Returns env var value when set
	t.Setenv("TEST_ENV_OR_DEFAULT", "custom-value")
	result = envOrDefault("TEST_ENV_OR_DEFAULT", "fallback")
	assert.Equal(t, "custom-value", result)
}

func TestEnvOrDefaultInt(t *testing.T) {
	// Returns default when env var is not set
	val, err := envOrDefaultInt("TEST_NONEXISTENT_INT_12345", 42)
	require.NoError(t, err)
	assert.Equal(t, 42, val)

	// Returns parsed int when env var is set
	t.Setenv("TEST_INT_VAR", "99")
	val, err = envOrDefaultInt("TEST_INT_VAR", 42)
	require.NoError(t, err)
	assert.Equal(t, 99, val)

	// Returns error when env var cannot be parsed as int
	t.Setenv("TEST_BAD_INT_VAR", "abc")
	_, err = envOrDefaultInt("TEST_BAD_INT_VAR", 42)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid integer value")
}

func TestEnvOrDefaultFloat64(t *testing.T) {
	// Returns default when env var is not set
	val, err := envOrDefaultFloat64("TEST_NONEXISTENT_FLOAT_12345", 3.14)
	require.NoError(t, err)
	assert.Equal(t, 3.14, val)

	// Returns parsed float when env var is set
	t.Setenv("TEST_FLOAT_VAR", "2.718")
	val, err = envOrDefaultFloat64("TEST_FLOAT_VAR", 3.14)
	require.NoError(t, err)
	assert.Equal(t, 2.718, val)

	// Returns error when env var cannot be parsed as float
	t.Setenv("TEST_BAD_FLOAT_VAR", "not-a-float")
	_, err = envOrDefaultFloat64("TEST_BAD_FLOAT_VAR", 3.14)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid float value")
}
