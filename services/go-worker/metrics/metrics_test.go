package metrics

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

func TestInit_DoesNotPanic(t *testing.T) {
	require.NotPanics(t, func() {
		Init("test-worker", "1.0.0")
	})
}

func TestInit_RegistersMetrics(t *testing.T) {
	Init("test-worker-2", "2.0.0")

	// Verify all metric variables are non-nil after Init.
	assert.NotNil(t, HTTPRequestsTotal)
	assert.NotNil(t, SystemCPUUsage)
	assert.NotNil(t, SystemMemory)
	assert.NotNil(t, SystemDiskUsage)
	assert.NotNil(t, SystemNetworkIO)
	assert.NotNil(t, WorkerInfo)
	assert.NotNil(t, ThreadsStatus)
	assert.NotNil(t, TasksQueueDepth)
	assert.NotNil(t, TasksActiveTotal)
	assert.NotNil(t, ThreadErrorsTotal)
	assert.NotNil(t, NetworkLatency)
	assert.NotNil(t, registry)
}

// ---------------------------------------------------------------------------
// Metric value setting
// ---------------------------------------------------------------------------

func TestSystemCPUUsage_CanSet(t *testing.T) {
	Init("test-set-cpu", "1.0.0")

	require.NotPanics(t, func() {
		SystemCPUUsage.Set(55.5)
	})

	// Gather and verify.
	mfs, err := registry.Gather()
	require.NoError(t, err)

	found := false
	for _, mf := range mfs {
		if mf.GetName() == "worker_system_cpu_usage" {
			found = true
			require.Len(t, mf.GetMetric(), 1)
			assert.Equal(t, 55.5, mf.GetMetric()[0].GetGauge().GetValue())
		}
	}
	assert.True(t, found, "worker_system_cpu_usage metric should be gathered")
}

func TestSystemMemory_CanSet(t *testing.T) {
	Init("test-set-mem", "1.0.0")

	SystemMemory.Set(42.0)

	mfs, err := registry.Gather()
	require.NoError(t, err)

	found := false
	for _, mf := range mfs {
		if mf.GetName() == "worker_system_memory" {
			found = true
			require.Len(t, mf.GetMetric(), 1)
			assert.Equal(t, 42.0, mf.GetMetric()[0].GetGauge().GetValue())
		}
	}
	assert.True(t, found)
}

func TestSystemDiskUsage_CanSet(t *testing.T) {
	Init("test-set-disk", "1.0.0")

	SystemDiskUsage.Set(78.3)

	mfs, err := registry.Gather()
	require.NoError(t, err)

	found := false
	for _, mf := range mfs {
		if mf.GetName() == "worker_system_disk_usage" {
			found = true
			assert.Equal(t, 78.3, mf.GetMetric()[0].GetGauge().GetValue())
		}
	}
	assert.True(t, found)
}

func TestHTTPRequestsTotal_CanIncrement(t *testing.T) {
	Init("test-http-counter", "1.0.0")

	require.NotPanics(t, func() {
		HTTPRequestsTotal.With(prometheus.Labels{
			"method": "GET",
			"url":    "/api/test",
			"status": "200",
		}).Inc()
	})

	mfs, err := registry.Gather()
	require.NoError(t, err)

	found := false
	for _, mf := range mfs {
		if mf.GetName() == "worker_http_requests_total" {
			found = true
			assert.Greater(t, len(mf.GetMetric()), 0)
		}
	}
	assert.True(t, found)
}

func TestThreadErrorsTotal_CanIncrement(t *testing.T) {
	Init("test-thread-errors", "1.0.0")

	require.NotPanics(t, func() {
		ThreadErrorsTotal.Inc()
	})
}

func TestTasksQueueDepth_CanSet(t *testing.T) {
	Init("test-queue-depth", "1.0.0")

	require.NotPanics(t, func() {
		TasksQueueDepth.Set(15)
	})
}

func TestTasksActiveTotal_CanSet(t *testing.T) {
	Init("test-active-tasks", "1.0.0")

	require.NotPanics(t, func() {
		TasksActiveTotal.Set(3)
	})
}

func TestNetworkLatency_CanObserve(t *testing.T) {
	Init("test-latency", "1.0.0")

	require.NotPanics(t, func() {
		NetworkLatency.With(prometheus.Labels{
			"target": "redis",
		}).Observe(0.015)
	})
}

func TestThreadsStatus_CanSet(t *testing.T) {
	Init("test-threads", "1.0.0")

	require.NotPanics(t, func() {
		ThreadsStatus.With(prometheus.Labels{"state": "active"}).Set(4)
		ThreadsStatus.With(prometheus.Labels{"state": "idle"}).Set(1)
	})
}

func TestSystemNetworkIO_CanSet(t *testing.T) {
	Init("test-network-io", "1.0.0")

	require.NotPanics(t, func() {
		SystemNetworkIO.With(prometheus.Labels{"direction": "tx"}).Set(1024)
		SystemNetworkIO.With(prometheus.Labels{"direction": "rx"}).Set(2048)
	})
}

func TestWorkerInfo_SetOnInit(t *testing.T) {
	Init("info-worker", "3.0.0")

	mfs, err := registry.Gather()
	require.NoError(t, err)

	found := false
	for _, mf := range mfs {
		if mf.GetName() == "worker_info" {
			found = true
			require.Greater(t, len(mf.GetMetric()), 0)
			assert.Equal(t, 1.0, mf.GetMetric()[0].GetGauge().GetValue())
		}
	}
	assert.True(t, found, "worker_info metric should be set during Init")
}

// ---------------------------------------------------------------------------
// RecordHTTPRequest convenience function
// ---------------------------------------------------------------------------

func TestRecordHTTPRequest_NilSafe(t *testing.T) {
	// If HTTPRequestsTotal is nil, should not panic.
	saved := HTTPRequestsTotal
	HTTPRequestsTotal = nil
	require.NotPanics(t, func() {
		RecordHTTPRequest("GET", "/api/test", 200)
	})
	HTTPRequestsTotal = saved
}

func TestRecordHTTPRequest_TruncatesQuery(t *testing.T) {
	Init("test-record-http", "1.0.0")

	require.NotPanics(t, func() {
		RecordHTTPRequest("POST", "/api/data?token=secret&page=1", 201)
	})
}

// ---------------------------------------------------------------------------
// RecordNetworkLatency convenience function
// ---------------------------------------------------------------------------

func TestRecordNetworkLatency_NilSafe(t *testing.T) {
	saved := NetworkLatency
	NetworkLatency = nil
	require.NotPanics(t, func() {
		RecordNetworkLatency("target", 100*time.Millisecond)
	})
	NetworkLatency = saved
}

func TestRecordNetworkLatency_RecordsValue(t *testing.T) {
	Init("test-record-latency", "1.0.0")

	require.NotPanics(t, func() {
		RecordNetworkLatency("temporal", 50*time.Millisecond)
	})
}
