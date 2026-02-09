package filecopy

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewCopyPool(t *testing.T) {
	pool := NewCopyPool(5, "1kb,1500;1mb,1000", 1048576)
	require.NotNil(t, pool)
	assert.Equal(t, 5, pool.workerCount)
	assert.Len(t, pool.bands, 2)
}

func TestNewCopyPool_DefaultThreadCount(t *testing.T) {
	pool := NewCopyPool(0, "", 1048576)
	require.NotNil(t, pool)
	assert.Equal(t, 5, pool.workerCount) // Default when <= 0
}

func TestNewCopyPool_NegativeThreadCount(t *testing.T) {
	pool := NewCopyPool(-1, "", 1048576)
	require.NotNil(t, pool)
	assert.Equal(t, 5, pool.workerCount)
}

func TestNewCopyPool_EmptyBandsConfig(t *testing.T) {
	pool := NewCopyPool(3, "", 1048576)
	require.NotNil(t, pool)
	// Should use default bands (5 bands)
	assert.Len(t, pool.bands, 5)
}

func TestNewCopyPool_InvalidBandsConfig(t *testing.T) {
	pool := NewCopyPool(3, "invalid-config", 1048576)
	require.NotNil(t, pool)
	// Should fall back to default bands
	assert.Len(t, pool.bands, 5)
}

func TestCopyPool_StartStop(t *testing.T) {
	pool := NewCopyPool(2, "", 1048576)

	pool.Start()

	metrics := pool.Metrics()
	assert.Equal(t, 2, metrics.TotalWorkers)

	pool.Stop()

	// Double-stop should be safe
	pool.Stop()
}

func TestCopyPool_SubmitAndReceiveResult(t *testing.T) {
	tmpDir := t.TempDir()

	// Create source file
	srcPath := filepath.Join(tmpDir, "src.txt")
	err := os.WriteFile(srcPath, []byte("test file content"), 0644)
	require.NoError(t, err)

	dstPath := filepath.Join(tmpDir, "dst.txt")

	pool := NewCopyPool(2, "", 1048576)
	pool.Start()
	defer pool.Stop()

	task := CopyTask{
		ID:            "task-1",
		Source:        srcPath,
		Dest:          dstPath,
		Size:          17,
		MaxBufferSize: 1048576,
	}

	resultCh := pool.Submit(task)
	result := <-resultCh

	require.NoError(t, result.Err)
	require.NotNil(t, result.Checksums)
	assert.Equal(t, result.Checksums.SourceChecksum, result.Checksums.TargetChecksum)
}

func TestCopyPool_SubmitWithMissingSource(t *testing.T) {
	pool := NewCopyPool(2, "", 1048576)
	pool.Start()
	defer pool.Stop()

	tmpDir := t.TempDir()
	task := CopyTask{
		ID:            "task-err",
		Source:        filepath.Join(tmpDir, "nonexistent.txt"),
		Dest:          filepath.Join(tmpDir, "dest.txt"),
		Size:          100,
		MaxBufferSize: 1048576,
	}

	resultCh := pool.Submit(task)
	result := <-resultCh

	assert.Error(t, result.Err)
	assert.Nil(t, result.Checksums)
}

func TestCopyPool_SubmitAfterStop(t *testing.T) {
	pool := NewCopyPool(2, "", 1048576)
	pool.Start()
	pool.Stop()

	task := CopyTask{
		ID:            "task-stopped",
		Source:        "/tmp/src",
		Dest:          "/tmp/dst",
		Size:          100,
		MaxBufferSize: 1048576,
	}

	resultCh := pool.Submit(task)
	result := <-resultCh

	assert.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "copy pool is stopped")
}

func TestCopyPool_ConcurrentSubmission(t *testing.T) {
	tmpDir := t.TempDir()

	pool := NewCopyPool(4, "", 1048576)
	pool.Start()
	defer pool.Stop()

	numTasks := 10
	var wg sync.WaitGroup

	results := make([]CopyResult, numTasks)

	for i := 0; i < numTasks; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			srcPath := filepath.Join(tmpDir, "src", filepath.Base(t.Name()), string(rune('a'+idx))+".txt")
			dstPath := filepath.Join(tmpDir, "dst", filepath.Base(t.Name()), string(rune('a'+idx))+".txt")

			err := os.MkdirAll(filepath.Dir(srcPath), 0755)
			require.NoError(t, err)

			content := []byte("content for task " + string(rune('a'+idx)))
			err = os.WriteFile(srcPath, content, 0644)
			require.NoError(t, err)

			task := CopyTask{
				ID:            "task-" + string(rune('a'+idx)),
				Source:        srcPath,
				Dest:          dstPath,
				Size:          int64(len(content)),
				MaxBufferSize: 1048576,
			}

			ch := pool.Submit(task)
			results[idx] = <-ch
		}(i)
	}

	wg.Wait()

	for i, result := range results {
		assert.NoError(t, result.Err, "task %d failed", i)
		if result.Checksums != nil {
			assert.Equal(t, result.Checksums.SourceChecksum, result.Checksums.TargetChecksum)
		}
	}
}

func TestCopyPool_Metrics(t *testing.T) {
	pool := NewCopyPool(3, "", 1048576)
	pool.Start()
	defer pool.Stop()

	metrics := pool.Metrics()
	assert.Equal(t, 3, metrics.TotalWorkers)
	assert.Equal(t, int64(3), metrics.AvailableWorkers)
	assert.Equal(t, int64(0), metrics.ActiveTasks)
}

func TestCopyPool_Bands(t *testing.T) {
	pool := NewCopyPool(2, "1kb,500;10mb,50", 1048576)
	bands := pool.Bands()
	require.Len(t, bands, 2)
	assert.Equal(t, "1kb", bands[0].Name)
	assert.Equal(t, int64(1024), bands[0].MaxSize)
	assert.Equal(t, 500, bands[0].MaxFetch)
	assert.Equal(t, "10mb", bands[1].Name)
	assert.Equal(t, int64(10485760), bands[1].MaxSize)
	assert.Equal(t, 50, bands[1].MaxFetch)
}

func TestParseBandsConfig_Valid(t *testing.T) {
	bands, err := parseBandsConfig("1kb,1500;1mb,1000;10mb,100")
	require.NoError(t, err)
	require.Len(t, bands, 3)

	assert.Equal(t, "1kb", bands[0].Name)
	assert.Equal(t, int64(1024), bands[0].MaxSize)
	assert.Equal(t, 1500, bands[0].MaxFetch)

	assert.Equal(t, "1mb", bands[1].Name)
	assert.Equal(t, int64(1048576), bands[1].MaxSize)
	assert.Equal(t, 1000, bands[1].MaxFetch)

	assert.Equal(t, "10mb", bands[2].Name)
	assert.Equal(t, int64(10485760), bands[2].MaxSize)
	assert.Equal(t, 100, bands[2].MaxFetch)
}

func TestParseBandsConfig_AllSizeNames(t *testing.T) {
	bands, err := parseBandsConfig("1kb,10;1mb,20;10mb,30;100mb,40;1gb,50")
	require.NoError(t, err)
	require.Len(t, bands, 5)

	assert.Equal(t, int64(1024), bands[0].MaxSize)
	assert.Equal(t, int64(1048576), bands[1].MaxSize)
	assert.Equal(t, int64(10485760), bands[2].MaxSize)
	assert.Equal(t, int64(104857600), bands[3].MaxSize)
	assert.Equal(t, int64(1073741824), bands[4].MaxSize)
}

func TestParseBandsConfig_Empty(t *testing.T) {
	bands, err := parseBandsConfig("")
	require.NoError(t, err)
	// Should return default bands
	assert.Len(t, bands, 5)
}

func TestParseBandsConfig_InvalidEntry(t *testing.T) {
	_, err := parseBandsConfig("bad-entry")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expected format")
}

func TestParseBandsConfig_InvalidSize(t *testing.T) {
	_, err := parseBandsConfig("unknown_size,100")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid band size")
}

func TestParseBandsConfig_InvalidMaxFetch(t *testing.T) {
	_, err := parseBandsConfig("1kb,not-a-number")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid maxFetch")
}

func TestParseBandsConfig_WhitespaceHandling(t *testing.T) {
	bands, err := parseBandsConfig("  1kb , 1500 ; 1mb , 1000  ")
	require.NoError(t, err)
	require.Len(t, bands, 2)
	assert.Equal(t, "1kb", bands[0].Name)
	assert.Equal(t, 1500, bands[0].MaxFetch)
}

func TestParseSizeName(t *testing.T) {
	tests := []struct {
		name     string
		expected int64
	}{
		{"1kb", 1024},
		{"1KB", 1024},
		{"1mb", 1048576},
		{"10mb", 10485760},
		{"100mb", 104857600},
		{"1gb", 1073741824},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := parseSizeName(tt.name)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestParseSizeName_NumericFallback(t *testing.T) {
	result, err := parseSizeName("4096")
	require.NoError(t, err)
	assert.Equal(t, int64(4096), result)
}

func TestParseSizeName_Invalid(t *testing.T) {
	_, err := parseSizeName("invalid")
	assert.Error(t, err)
}

func TestDefaultBands(t *testing.T) {
	bands := defaultBands()
	require.Len(t, bands, 5)

	assert.Equal(t, "1kb", bands[0].Name)
	assert.Equal(t, "1mb", bands[1].Name)
	assert.Equal(t, "10mb", bands[2].Name)
	assert.Equal(t, "100mb", bands[3].Name)
	assert.Equal(t, "1gb", bands[4].Name)
}
