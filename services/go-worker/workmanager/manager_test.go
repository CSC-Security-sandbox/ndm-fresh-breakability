package workmanager

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// ---------------------------------------------------------------------------
// keyvalsToFields
// ---------------------------------------------------------------------------

func TestKeyvalsToFields_Empty(t *testing.T) {
	fields := keyvalsToFields(nil)
	assert.Empty(t, fields)
}

func TestKeyvalsToFields_SinglePair(t *testing.T) {
	fields := keyvalsToFields([]interface{}{"key", "value"})
	require.Len(t, fields, 1)
	assert.Equal(t, "key", fields[0].Key)
}

func TestKeyvalsToFields_MultiplePairs(t *testing.T) {
	fields := keyvalsToFields([]interface{}{
		"name", "test",
		"count", 42,
		"active", true,
	})
	assert.Len(t, fields, 3)
	assert.Equal(t, "name", fields[0].Key)
	assert.Equal(t, "count", fields[1].Key)
	assert.Equal(t, "active", fields[2].Key)
}

func TestKeyvalsToFields_OddNumberOfArgs(t *testing.T) {
	// Odd number of keyvals -> last element is dropped.
	fields := keyvalsToFields([]interface{}{"key", "value", "orphan"})
	assert.Len(t, fields, 1)
}

func TestKeyvalsToFields_NonStringKey(t *testing.T) {
	fields := keyvalsToFields([]interface{}{123, "value"})
	require.Len(t, fields, 1)
	assert.Equal(t, "123", fields[0].Key)
}

// ---------------------------------------------------------------------------
// applyRegistrationOverrides
// ---------------------------------------------------------------------------

func TestApplyRegistrationOverrides_NilResponse(t *testing.T) {
	log := logger.NewLogger("test")
	cfg := &config.Config{
		TemporalAddress: "original-address:7233",
	}
	wm := &WorkManager{
		cfg:    cfg,
		logger: log,
	}

	// Should not panic.
	wm.applyRegistrationOverrides(nil)
	assert.Equal(t, "original-address:7233", cfg.TemporalAddress)
}

func TestApplyRegistrationOverrides_PartialOverrides(t *testing.T) {
	log := logger.NewLogger("test")
	cfg := &config.Config{
		TemporalAddress: "original:7233",
		RedisHost:       "original-redis",
		RedisPort:       "6379",
		RedisUsername:    "olduser",
		RedisPassword:   "oldpass",
	}
	wm := &WorkManager{
		cfg:    cfg,
		logger: log,
	}

	resp := &registrationResponse{}
	resp.Data.TemporalAddress = "new-temporal:7233"
	resp.Data.RedisHost = "new-redis"
	// RedisPort is empty -> should not override.

	wm.applyRegistrationOverrides(resp)

	assert.Equal(t, "new-temporal:7233", cfg.TemporalAddress)
	assert.Equal(t, "new-redis", cfg.RedisHost)
	assert.Equal(t, "6379", cfg.RedisPort, "should not be overridden when empty")
	assert.Equal(t, "olduser", cfg.RedisUsername)
}

func TestApplyRegistrationOverrides_AllOverrides(t *testing.T) {
	log := logger.NewLogger("test")
	cfg := &config.Config{}
	wm := &WorkManager{
		cfg:    cfg,
		logger: log,
	}

	resp := &registrationResponse{}
	resp.Data.TemporalAddress = "temporal:7233"
	resp.Data.TemporalTLSEnabled = true
	resp.Data.TemporalTLSCACert = "CERT-DATA"
	resp.Data.TemporalTLSServerName = "server.example.com"
	resp.Data.RedisHost = "redis-host"
	resp.Data.RedisPort = "6380"
	resp.Data.RedisUsername = "redisuser"
	resp.Data.RedisPassword = "redispass"

	wm.applyRegistrationOverrides(resp)

	assert.Equal(t, "temporal:7233", cfg.TemporalAddress)
	assert.True(t, cfg.TemporalTLSEnabled)
	assert.Equal(t, "CERT-DATA", cfg.TemporalTLSCACert)
	assert.Equal(t, "server.example.com", cfg.TemporalTLSServerName)
	assert.Equal(t, "redis-host", cfg.RedisHost)
	assert.Equal(t, "6380", cfg.RedisPort)
	assert.Equal(t, "redisuser", cfg.RedisUsername)
	assert.Equal(t, "redispass", cfg.RedisPassword)
}

// ---------------------------------------------------------------------------
// NewWorkManager
// ---------------------------------------------------------------------------

func TestNewWorkManager(t *testing.T) {
	log := logger.NewLogger("test")
	cfg := &config.Config{
		WorkerID: "test-worker",
	}

	wm := NewWorkManager(cfg, nil, nil, nil, log)
	require.NotNil(t, wm)
	assert.NotNil(t, wm.activeWorkers)
	assert.NotNil(t, wm.done)
	assert.Equal(t, cfg, wm.cfg)
}

// ---------------------------------------------------------------------------
// temporalLogger
// ---------------------------------------------------------------------------

func TestTemporalLogger_Methods(t *testing.T) {
	log := logger.NewLogger("test")
	tl := newTemporalLogger(log)

	// These should not panic. We just verify they accept the correct signatures.
	require.NotPanics(t, func() {
		tl.Debug("debug msg", "key", "value")
	})
	require.NotPanics(t, func() {
		tl.Info("info msg", "key", "value")
	})
	require.NotPanics(t, func() {
		tl.Warn("warn msg", "key", "value")
	})
	require.NotPanics(t, func() {
		tl.Error("error msg", "key", "value")
	})
}

// ---------------------------------------------------------------------------
// MetaConfig types
// ---------------------------------------------------------------------------

func TestWorkerTypeConstants(t *testing.T) {
	assert.Equal(t, WorkerType("PARENT_WORKFLOW"), ParentWorkflow)
	assert.Equal(t, WorkerType("WORKER_SPECIFIC"), WorkerSpecific)
	assert.Equal(t, WorkerType("JOB_SPECIFIC"), JobSpecific)
}

// ---------------------------------------------------------------------------
// keyvalsToFields uses zap.Any
// ---------------------------------------------------------------------------

func TestKeyvalsToFields_WithZapAny(t *testing.T) {
	fields := keyvalsToFields([]interface{}{"duration", 42.5, "slice", []int{1, 2, 3}})
	require.Len(t, fields, 2)

	// Verify field types.
	assert.Equal(t, zap.Any("duration", 42.5).Key, fields[0].Key)
	assert.Equal(t, zap.Any("slice", []int{1, 2, 3}).Key, fields[1].Key)
}
