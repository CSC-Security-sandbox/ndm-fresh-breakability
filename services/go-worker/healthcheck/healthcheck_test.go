//go:build linux

package healthcheck

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// ---------------------------------------------------------------------------
// calculateCPUPercent
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
// getMemoryPercent
// ---------------------------------------------------------------------------

func TestGetMemoryPercent_ReturnsNonNegative(t *testing.T) {
	result := getMemoryPercent()
	assert.GreaterOrEqual(t, result, 0.0)
	assert.LessOrEqual(t, result, 100.0)
}

// ---------------------------------------------------------------------------
// getDiskPercent
// ---------------------------------------------------------------------------

func TestGetDiskPercent_RootPath(t *testing.T) {
	result := getDiskPercent("/")
	assert.GreaterOrEqual(t, result, 0.0)
	assert.LessOrEqual(t, result, 100.0)
}

func TestGetDiskPercent_EmptyPath(t *testing.T) {
	// Empty path defaults to "/".
	result := getDiskPercent("")
	assert.GreaterOrEqual(t, result, 0.0)
}

func TestGetDiskPercent_NonExistentPath(t *testing.T) {
	result := getDiskPercent("/nonexistent/path/12345")
	assert.Equal(t, 0.0, result)
}

// ---------------------------------------------------------------------------
// readCPUTimes
// ---------------------------------------------------------------------------

func TestReadCPUTimes_ReturnsValidValues(t *testing.T) {
	times, err := readCPUTimes()
	assert.NoError(t, err)
	assert.Greater(t, times.total, uint64(0))
	// idle may be 0 on very busy systems but total should not.
}
