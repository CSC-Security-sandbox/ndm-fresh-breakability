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
// applyEnvOverrides
// ---------------------------------------------------------------------------

func TestApplyEnvOverrides_NilPayload(t *testing.T) {
	log := logger.NewLogger("test", "debug")
	cfg := &config.Config{
		TemporalAddress: "original-address:7233",
	}
	wm := &WorkManager{
		cfg:    cfg,
		logger: log,
	}

	// Should not panic.
	wm.applyEnvOverrides(nil)
	assert.Equal(t, "original-address:7233", cfg.TemporalAddress)
}

func TestApplyEnvOverrides_PartialOverrides(t *testing.T) {
	log := logger.NewLogger("test", "debug")
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

	cp := &configPayload{
		EnvVariables: map[string]string{
			"TEMPORAL_ADDRESS": "new-temporal:7233",
			"REDIS_HOST":       "new-redis",
			// REDIS_PORT missing -> should not override.
		},
	}

	wm.applyEnvOverrides(cp)

	assert.Equal(t, "new-temporal:7233", cfg.TemporalAddress)
	assert.Equal(t, "new-redis", cfg.RedisHost)
	assert.Equal(t, "6379", cfg.RedisPort, "should not be overridden when missing")
	assert.Equal(t, "olduser", cfg.RedisUsername)
}

func TestApplyEnvOverrides_AllOverrides(t *testing.T) {
	log := logger.NewLogger("test", "debug")
	cfg := &config.Config{}
	wm := &WorkManager{
		cfg:    cfg,
		logger: log,
	}

	cp := &configPayload{
		EnvVariables: map[string]string{
			"TEMPORAL_ADDRESS":        "temporal:7233",
			"TEMPORAL_TLS_CA_CERT":    "CERT-DATA",
			"TEMPORAL_TLS_SERVER_NAME": "server.example.com",
			"REDIS_HOST":              "redis-host",
			"REDIS_PORT":              "6380",
			"REDIS_USERNAME":          "redisuser",
			"REDIS_PASSWORD":          "redispass",
		},
	}

	wm.applyEnvOverrides(cp)

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
// parseConfigResponse
// ---------------------------------------------------------------------------

func TestParseConfigResponse_ValidEnvelope(t *testing.T) {
	// JSON uses the actual configName values sent by the config service
	// (the TS WorkFlowType enum values, NOT the enum keys).
	raw := []byte(`{
		"trackId": "t-1",
		"message": "ok",
		"data": {
			"items": {
				"metaConfig": [
					{"workerId":"w1","configName":"parent-workflow-tasks","taskQueueId":null,"dynamicTaskQueue":false},
					{"workerId":"w1","configName":"worker-specific-tasks","taskQueueId":"w1","dynamicTaskQueue":true}
				],
				"envVariables": {"TEMPORAL_TLS_CA_CERT": "cert-data"}
			}
		}
	}`)

	cp, err := parseConfigResponse(raw)
	require.NoError(t, err)
	require.NotNil(t, cp)
	assert.Len(t, cp.MetaConfig, 2)
	assert.Equal(t, "parent-workflow-tasks", cp.MetaConfig[0].ConfigName)
	assert.Equal(t, "worker-specific-tasks", cp.MetaConfig[1].ConfigName)
	assert.True(t, cp.MetaConfig[1].DynamicTaskQueue)
	assert.Equal(t, "w1", cp.MetaConfig[1].TaskQueueID)
	assert.Equal(t, "cert-data", cp.EnvVariables["TEMPORAL_TLS_CA_CERT"])
}

// ---------------------------------------------------------------------------
// getWorkerIdentity
// ---------------------------------------------------------------------------

func TestGetWorkerIdentity_Static(t *testing.T) {
	wc := WorkerConfiguration{WorkerID: "w1", ConfigName: "parent-workflow-tasks", DynamicTaskQueue: false}
	assert.Equal(t, "w1/parent-workflow-tasks", getWorkerIdentity(wc))
}

func TestGetWorkerIdentity_Dynamic(t *testing.T) {
	wc := WorkerConfiguration{WorkerID: "w1", ConfigName: "worker-specific-tasks", TaskQueueID: "w1", DynamicTaskQueue: true}
	assert.Equal(t, "w1/worker-specific-tasks-w1", getWorkerIdentity(wc))
}

// ---------------------------------------------------------------------------
// resolveTaskQueue
// ---------------------------------------------------------------------------

func TestResolveTaskQueue_Parent(t *testing.T) {
	wc := WorkerConfiguration{ConfigName: configNameParentWorkflow, DynamicTaskQueue: false}
	assert.Equal(t, "ParentWorkflow-TaskQueue", resolveTaskQueue(wc))
}

func TestResolveTaskQueue_WorkerSpecific(t *testing.T) {
	wc := WorkerConfiguration{ConfigName: configNameWorkerSpecific, TaskQueueID: "w1", DynamicTaskQueue: true}
	assert.Equal(t, "w1-TaskQueue", resolveTaskQueue(wc))
}

func TestResolveTaskQueue_JobSpecific(t *testing.T) {
	wc := WorkerConfiguration{ConfigName: configNameJobSpecific, TaskQueueID: "job-123", DynamicTaskQueue: true}
	assert.Equal(t, "job-123-TaskQueue", resolveTaskQueue(wc))
}

// ---------------------------------------------------------------------------
// resolveWorkerType
// ---------------------------------------------------------------------------

func TestResolveWorkerType(t *testing.T) {
	assert.Equal(t, ParentWorkflow, resolveWorkerType(configNameParentWorkflow))
	assert.Equal(t, WorkerSpecific, resolveWorkerType(configNameWorkerSpecific))
	assert.Equal(t, JobSpecific, resolveWorkerType(configNameJobSpecific))
	assert.Equal(t, WorkerSpecific, resolveWorkerType("UNKNOWN"))
}

// ---------------------------------------------------------------------------
// NewWorkManager
// ---------------------------------------------------------------------------

func TestNewWorkManager(t *testing.T) {
	log := logger.NewLogger("test", "debug")
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
	log := logger.NewLogger("test", "debug")
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
// WorkerType constants
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

// ---------------------------------------------------------------------------
// normalizeLocalhost
// ---------------------------------------------------------------------------

func TestNormalizeLocalhost(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"localhost:7233", "127.0.0.1:7233"},
		{"LOCALHOST:7233", "127.0.0.1:7233"},
		{"Localhost:7233", "127.0.0.1:7233"},
		{"localhost", "127.0.0.1"},
		{"192.168.1.1:7233", "192.168.1.1:7233"},
		{"temporal.example.com:7233", "temporal.example.com:7233"},
		{"127.0.0.1:7233", "127.0.0.1:7233"},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, normalizeLocalhost(tt.input))
		})
	}
}

// ---------------------------------------------------------------------------
// collectEnvVars
// ---------------------------------------------------------------------------

func TestCollectEnvVars(t *testing.T) {
	m := collectEnvVars()
	// PATH should always be present in a normal environment.
	_, ok := m["PATH"]
	assert.True(t, ok, "PATH should be present in collected env vars")
}
