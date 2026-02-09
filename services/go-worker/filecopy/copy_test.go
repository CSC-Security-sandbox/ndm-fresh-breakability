package filecopy

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSmartCopy_Success(t *testing.T) {
	tmpDir := t.TempDir()

	// Create source file with known content
	srcPath := filepath.Join(tmpDir, "source.txt")
	content := []byte("hello world, this is a test file for smart copy")
	err := os.WriteFile(srcPath, content, 0644)
	require.NoError(t, err)

	dstPath := filepath.Join(tmpDir, "dest", "output.txt")

	checksums, err := SmartCopy(srcPath, dstPath, int64(len(content)), 1048576)
	require.NoError(t, err)
	require.NotNil(t, checksums)

	// Source and target checksums should match
	assert.Equal(t, checksums.SourceChecksum, checksums.TargetChecksum)
	assert.NotEmpty(t, checksums.SourceChecksum)

	// Verify target file exists and has same content
	dstContent, err := os.ReadFile(dstPath)
	require.NoError(t, err)
	assert.Equal(t, content, dstContent)
}

func TestSmartCopy_CreatesDestinationDirectory(t *testing.T) {
	tmpDir := t.TempDir()

	srcPath := filepath.Join(tmpDir, "source.txt")
	err := os.WriteFile(srcPath, []byte("data"), 0644)
	require.NoError(t, err)

	// Destination is in a nested directory that doesn't exist yet
	dstPath := filepath.Join(tmpDir, "a", "b", "c", "dest.txt")

	checksums, err := SmartCopy(srcPath, dstPath, 4, 1048576)
	require.NoError(t, err)
	require.NotNil(t, checksums)

	// Verify destination file was created
	_, err = os.Stat(dstPath)
	assert.NoError(t, err)
}

func TestSmartCopy_MissingSourceFile(t *testing.T) {
	tmpDir := t.TempDir()
	srcPath := filepath.Join(tmpDir, "nonexistent.txt")
	dstPath := filepath.Join(tmpDir, "dest.txt")

	checksums, err := SmartCopy(srcPath, dstPath, 100, 1048576)
	assert.Error(t, err)
	assert.Nil(t, checksums)
	assert.Contains(t, err.Error(), "does not exist or is not readable")
}

func TestSmartCopy_EmptyFile(t *testing.T) {
	tmpDir := t.TempDir()

	srcPath := filepath.Join(tmpDir, "empty.txt")
	err := os.WriteFile(srcPath, []byte{}, 0644)
	require.NoError(t, err)

	dstPath := filepath.Join(tmpDir, "empty_copy.txt")

	checksums, err := SmartCopy(srcPath, dstPath, 0, 1048576)
	require.NoError(t, err)
	require.NotNil(t, checksums)

	assert.Equal(t, checksums.SourceChecksum, checksums.TargetChecksum)

	info, err := os.Stat(dstPath)
	require.NoError(t, err)
	assert.Equal(t, int64(0), info.Size())
}

func TestSmartCopy_LargerFile(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file larger than the smallest buffer tier (64KB)
	srcPath := filepath.Join(tmpDir, "large.bin")
	data := make([]byte, 100000) // 100KB
	for i := range data {
		data[i] = byte(i % 256)
	}
	err := os.WriteFile(srcPath, data, 0644)
	require.NoError(t, err)

	dstPath := filepath.Join(tmpDir, "large_copy.bin")

	checksums, err := SmartCopy(srcPath, dstPath, int64(len(data)), 1048576)
	require.NoError(t, err)
	require.NotNil(t, checksums)

	assert.Equal(t, checksums.SourceChecksum, checksums.TargetChecksum)
}

func TestCalculateChecksum(t *testing.T) {
	tmpDir := t.TempDir()

	filePath := filepath.Join(tmpDir, "checksum.txt")
	err := os.WriteFile(filePath, []byte("deterministic content"), 0644)
	require.NoError(t, err)

	checksum1, err := CalculateChecksum(filePath)
	require.NoError(t, err)
	assert.NotEmpty(t, checksum1)

	// Same content should produce same checksum
	checksum2, err := CalculateChecksum(filePath)
	require.NoError(t, err)
	assert.Equal(t, checksum1, checksum2)
}

func TestCalculateChecksum_DifferentContent(t *testing.T) {
	tmpDir := t.TempDir()

	file1 := filepath.Join(tmpDir, "file1.txt")
	file2 := filepath.Join(tmpDir, "file2.txt")

	err := os.WriteFile(file1, []byte("content A"), 0644)
	require.NoError(t, err)
	err = os.WriteFile(file2, []byte("content B"), 0644)
	require.NoError(t, err)

	checksum1, err := CalculateChecksum(file1)
	require.NoError(t, err)

	checksum2, err := CalculateChecksum(file2)
	require.NoError(t, err)

	assert.NotEqual(t, checksum1, checksum2)
}

func TestCalculateChecksum_NonexistentFile(t *testing.T) {
	_, err := CalculateChecksum("/nonexistent/path/file.txt")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to open file")
}

func TestGetOptimalBufferSize_SmallFile(t *testing.T) {
	// < 64KB -> 64KB
	assert.Equal(t, 65536, getOptimalBufferSize(100, 1048576))
	assert.Equal(t, 65536, getOptimalBufferSize(0, 1048576))
	assert.Equal(t, 65536, getOptimalBufferSize(65535, 1048576))
}

func TestGetOptimalBufferSize_MediumFile(t *testing.T) {
	// >= 64KB and < 500KB -> 256KB
	assert.Equal(t, 262144, getOptimalBufferSize(65536, 1048576))
	assert.Equal(t, 262144, getOptimalBufferSize(100000, 1048576))
	assert.Equal(t, 262144, getOptimalBufferSize(512499, 1048576))
}

func TestGetOptimalBufferSize_LargeFile(t *testing.T) {
	// >= 500KB and < 1MB -> 1MB
	assert.Equal(t, 1048576, getOptimalBufferSize(512500, 2097152))
	assert.Equal(t, 1048576, getOptimalBufferSize(1000000, 2097152))
	assert.Equal(t, 1048576, getOptimalBufferSize(1048575, 2097152))
}

func TestGetOptimalBufferSize_VeryLargeFile(t *testing.T) {
	// >= 1MB -> maxBufferSize
	assert.Equal(t, 2097152, getOptimalBufferSize(1048576, 2097152))
	assert.Equal(t, 4194304, getOptimalBufferSize(10000000, 4194304))
	assert.Equal(t, 1048576, getOptimalBufferSize(5000000, 1048576))
}
