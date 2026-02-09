package healthcheck

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// calculateCPUPercent (cross-platform — pure math)
// ---------------------------------------------------------------------------

func TestCalculateCPUPercent_ZeroDelta(t *testing.T) {
	prev := cpuTimes{idle: 100, total: 1000}
	cur := cpuTimes{idle: 100, total: 1000}

	result := calculateCPUPercent(prev, cur)
	assert.Equal(t, 0.0, result)
}

func TestCalculateCPUPercent_FullUsage(t *testing.T) {
	prev := cpuTimes{idle: 100, total: 1000}
	cur := cpuTimes{idle: 100, total: 2000} // idle didn't change, all delta is usage.

	result := calculateCPUPercent(prev, cur)
	assert.Equal(t, 100.0, result)
}

func TestCalculateCPUPercent_HalfUsage(t *testing.T) {
	prev := cpuTimes{idle: 0, total: 0}
	cur := cpuTimes{idle: 500, total: 1000} // 500 idle out of 1000 total = 50% usage.

	result := calculateCPUPercent(prev, cur)
	assert.Equal(t, 50.0, result)
}

func TestCalculateCPUPercent_NormalUsage(t *testing.T) {
	prev := cpuTimes{idle: 1000, total: 5000}
	cur := cpuTimes{idle: 1200, total: 6000}

	// totalDelta = 1000, idleDelta = 200
	// usage = (1000-200)/1000 * 100 = 80%
	result := calculateCPUPercent(prev, cur)
	assert.InDelta(t, 80.0, result, 0.01)
}

// ---------------------------------------------------------------------------
// readCPUTimes (platform-specific, but should work on both Linux & Darwin)
// ---------------------------------------------------------------------------

func TestReadCPUTimes_ReturnsValidValues(t *testing.T) {
	times, err := readCPUTimes()
	assert.NoError(t, err)
	assert.Greater(t, times.total, uint64(0))
}

// ---------------------------------------------------------------------------
// getSystemMemory (platform-specific, works on Linux & Darwin)
// ---------------------------------------------------------------------------

func TestGetSystemMemory_ReturnsPositive(t *testing.T) {
	total, free, err := getSystemMemory()
	assert.NoError(t, err)
	assert.Greater(t, total, uint64(0), "total memory should be positive")
	// free may be very small but total should never be zero
	_ = free
}

// ---------------------------------------------------------------------------
// getMemoryStats (cross-platform)
// ---------------------------------------------------------------------------

func TestGetMemoryStats_FormattedStrings(t *testing.T) {
	usage, limit := getMemoryStats()

	// Should not be error values.
	assert.NotEqual(t, "-1", usage, "memory usage should not be -1")
	assert.NotEqual(t, "-1", limit, "memory limit should not be -1")

	// Should end with expected suffixes.
	assert.Contains(t, usage, "%", "memory usage should contain %%")
	assert.Contains(t, limit, "GB", "memory limit should contain GB")
}

// ---------------------------------------------------------------------------
// getDiskStats (cross-platform — unix.Statfs works on Linux & Darwin)
// ---------------------------------------------------------------------------

func TestGetDiskStats_RootPath(t *testing.T) {
	usage, limit := getDiskStats("/")
	assert.NotEqual(t, "-1", usage)
	assert.NotEqual(t, "-1", limit)
	assert.Contains(t, usage, "%")
	assert.Contains(t, limit, "GB")
}

func TestGetDiskStats_EmptyPath(t *testing.T) {
	// Empty path defaults to "/".
	usage, limit := getDiskStats("")
	assert.NotEqual(t, "-1", usage)
	assert.NotEqual(t, "-1", limit)
}

func TestGetDiskStats_NonExistentPath(t *testing.T) {
	usage, limit := getDiskStats("/nonexistent/path/12345")
	assert.Equal(t, "-1", usage)
	assert.Equal(t, "-1", limit)
}

// ---------------------------------------------------------------------------
// statsPayload JSON structure
// ---------------------------------------------------------------------------

func TestStatsPayload_MatchesTSWorkerFormat(t *testing.T) {
	payload := statsPayload{
		WorkerID:     "test-worker-id",
		HealthStatus: "HEALTHY",
		SystemStats: systemStats{
			CPUUsage:    "45.67%",
			MemoryUsage: "67.89%",
			MemoryLimit: "16.00GB",
			DiskUsage:   "23.45%",
			DiskLimit:   "256.00GB",
		},
	}

	data, err := json.Marshal(payload)
	require.NoError(t, err)

	// Unmarshal into a generic map to verify field names.
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &m))

	// Top-level fields.
	assert.Equal(t, "test-worker-id", m["workerId"])
	assert.Equal(t, "HEALTHY", m["healthStatus"])

	// Nested systemStats.
	ss, ok := m["systemStats"].(map[string]interface{})
	require.True(t, ok, "systemStats should be an object")

	assert.Equal(t, "45.67%", ss["cpuUsage"])
	assert.Equal(t, "67.89%", ss["memoryUsage"])
	assert.Equal(t, "16.00GB", ss["memoryLimit"])
	assert.Equal(t, "23.45%", ss["diskUsage"])
	assert.Equal(t, "256.00GB", ss["diskLimit"])

	// Should NOT have the old flat fields.
	assert.Nil(t, m["cpu"], "should not have flat 'cpu' field")
	assert.Nil(t, m["memory"], "should not have flat 'memory' field")
	assert.Nil(t, m["disk"], "should not have flat 'disk' field")
	assert.Nil(t, m["timestamp"], "should not have 'timestamp' field")
}
