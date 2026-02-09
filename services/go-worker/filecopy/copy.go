package filecopy

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Checksums holds the SHA256 checksums for both the source and target files
// after a copy operation.
type Checksums struct {
	SourceChecksum string
	TargetChecksum string
}

// SmartCopy copies a file from source to target with optimal buffer sizing and
// SHA256 checksum verification. It computes the source checksum while copying
// (using io.TeeReader) and then reads the target to compute its checksum.
// This is a Linux-only implementation; no Windows 8.3 short-name handling is performed.
func SmartCopy(source, target string, fileSize int64, maxBufferSize int) (*Checksums, error) {
	bufferSize := getOptimalBufferSize(fileSize, maxBufferSize)

	// Step 1: Verify source file is readable.
	srcFile, err := os.Open(source)
	if err != nil {
		return nil, fmt.Errorf("source file %s does not exist or is not readable: %w", source, err)
	}
	defer srcFile.Close()

	// Step 2: Create destination directory if it does not exist.
	destDir := filepath.Dir(target)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create destination directory %s: %w", destDir, err)
	}

	// Step 3: Create destination file.
	dstFile, err := os.Create(target)
	if err != nil {
		return nil, fmt.Errorf("failed to create destination file %s: %w", target, err)
	}

	// Step 4: Set up SHA256 hash writer and TeeReader.
	hash := sha256.New()
	teeReader := io.TeeReader(srcFile, hash)

	// Step 5: Copy from source to destination using optimal buffer.
	buf := make([]byte, bufferSize)
	if _, err := io.CopyBuffer(dstFile, teeReader, buf); err != nil {
		dstFile.Close()
		return nil, fmt.Errorf("failed to copy file from %s to %s: %w", source, target, err)
	}

	// Step 6: Close destination file before computing its checksum.
	// This ensures all data is flushed to disk.
	if err := dstFile.Close(); err != nil {
		return nil, fmt.Errorf("failed to close destination file %s: %w", target, err)
	}

	// Step 7: Compute source checksum from the hash accumulated during copy.
	sourceChecksum := hex.EncodeToString(hash.Sum(nil))

	// Step 8: Compute target checksum by re-reading the written file.
	targetChecksum, err := CalculateChecksum(target)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate target checksum for %s: %w", target, err)
	}

	return &Checksums{
		SourceChecksum: sourceChecksum,
		TargetChecksum: targetChecksum,
	}, nil
}

// CalculateChecksum computes the SHA256 hash of a file and returns it as a
// lowercase hex-encoded string.
func CalculateChecksum(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file %s for checksum: %w", filePath, err)
	}
	defer f.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return "", fmt.Errorf("failed to read file %s for checksum: %w", filePath, err)
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

// getOptimalBufferSize returns the optimal buffer size based on file size.
// The tiers are:
//
//	fileSize < 65536 (64KB)    -> 65536  (64KB)
//	fileSize < 512500 (500KB)  -> 262144 (256KB)
//	fileSize < 1048576 (1MB)   -> 1048576 (1MB)
//	else                       -> maxBufferSize
func getOptimalBufferSize(fileSize int64, maxBufferSize int) int {
	switch {
	case fileSize < 65536:
		return 65536
	case fileSize < 512500:
		return 262144
	case fileSize < 1048576:
		return 1048576
	default:
		return maxBufferSize
	}
}
