package activities

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/types"
)

// ReadInput contains the parameters for the ReadActivity.
type ReadInput struct {
	JobRunID string `json:"jobRunId"`
	FilePath string `json:"filePath"`
	PathID   string `json:"pathId"`
}

// ReadOutput contains the results of the ReadActivity.
type ReadOutput struct {
	DurationMs int64  `json:"durationMs"`
	BytesRead  int64  `json:"bytesRead"`
	SpeedMBps  string `json:"speedMBps"`
}

// WriteInput contains the parameters for the WriteActivity.
type WriteInput struct {
	JobRunID string `json:"jobRunId"`
	FilePath string `json:"filePath"`
	PathID   string `json:"pathId"`
	SizeGB   float64 `json:"sizeGB"`
}

// WriteOutput contains the results of the WriteActivity.
type WriteOutput struct {
	DurationMs   int64  `json:"durationMs"`
	BytesWritten int64  `json:"bytesWritten"`
	SpeedMBps    string `json:"speedMBps"`
}

// NetPerfInput contains the parameters for NetworkPerformanceActivity.
type NetPerfInput struct {
	JobRunID   string `json:"jobRunId"`
	SourcePath string `json:"sourcePath"`
	TargetPath string `json:"targetPath"`
	SourceID   string `json:"sourceId"`
	TargetID   string `json:"targetId"`
	SizeGB     float64 `json:"sizeGB"`
}

// NetPerfOutput contains the results of the NetworkPerformanceActivity.
type NetPerfOutput struct {
	DurationMs int64  `json:"durationMs"`
	SpeedMBps  string `json:"speedMBps"`
}

// PostResultsInput contains the parameters for PostResultsActivity.
type PostResultsInput struct {
	JobRunID string                        `json:"jobRunId"`
	Results  []types.SpeedTestReadWriteInfo `json:"results"`
}

// ReadActivity measures the read speed from a file on a mounted share.
func (a *Activities) ReadActivity(ctx context.Context, input ReadInput) (*ReadOutput, error) {
	a.Logger.Info("ReadActivity started",
		zap.String("jobRunId", input.JobRunID),
		zap.String("filePath", input.FilePath),
	)

	mountDir := filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.PathID)
	fullPath := filepath.Join(mountDir, input.FilePath)

	// Get file size.
	stat, err := os.Stat(fullPath)
	if err != nil {
		return nil, fmt.Errorf("stat %s: %w", fullPath, err)
	}

	// Read the file and measure time.
	start := time.Now()

	f, err := os.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("opening %s for read: %w", fullPath, err)
	}
	defer f.Close()

	buf := make([]byte, 1024*1024) // 1MB buffer
	var totalRead int64
	for {
		n, readErr := f.Read(buf)
		totalRead += int64(n)
		if readErr != nil {
			break
		}
	}

	duration := time.Since(start)
	durationMs := duration.Milliseconds()
	if durationMs == 0 {
		durationMs = 1
	}

	speedMBps := float64(stat.Size()) / (1024 * 1024) / duration.Seconds()

	output := &ReadOutput{
		DurationMs: durationMs,
		BytesRead:  totalRead,
		SpeedMBps:  fmt.Sprintf("%.2f", speedMBps),
	}

	a.Logger.Info("ReadActivity completed",
		zap.String("jobRunId", input.JobRunID),
		zap.Int64("bytesRead", totalRead),
		zap.String("speedMBps", output.SpeedMBps),
	)

	return output, nil
}

// WriteActivity measures the write speed to a file on a mounted share.
func (a *Activities) WriteActivity(ctx context.Context, input WriteInput) (*WriteOutput, error) {
	a.Logger.Info("WriteActivity started",
		zap.String("jobRunId", input.JobRunID),
		zap.String("filePath", input.FilePath),
		zap.Float64("sizeGB", input.SizeGB),
	)

	mountDir := filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.PathID)
	fullPath := filepath.Join(mountDir, input.FilePath)

	// Ensure directory exists.
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return nil, fmt.Errorf("creating directory for %s: %w", fullPath, err)
	}

	// Calculate total bytes to write.
	totalBytes := int64(input.SizeGB * 1024 * 1024 * 1024)

	// Write the file and measure time.
	start := time.Now()

	f, err := os.Create(fullPath)
	if err != nil {
		return nil, fmt.Errorf("creating %s for write: %w", fullPath, err)
	}
	defer f.Close()

	buf := make([]byte, 1024*1024) // 1MB buffer of zeros
	var totalWritten int64
	for totalWritten < totalBytes {
		remaining := totalBytes - totalWritten
		writeSize := int64(len(buf))
		if remaining < writeSize {
			writeSize = remaining
		}
		n, writeErr := f.Write(buf[:writeSize])
		totalWritten += int64(n)
		if writeErr != nil {
			return nil, fmt.Errorf("writing to %s: %w", fullPath, writeErr)
		}
	}

	if err := f.Sync(); err != nil {
		return nil, fmt.Errorf("syncing %s: %w", fullPath, err)
	}

	duration := time.Since(start)
	durationMs := duration.Milliseconds()
	if durationMs == 0 {
		durationMs = 1
	}

	speedMBps := float64(totalWritten) / (1024 * 1024) / duration.Seconds()

	output := &WriteOutput{
		DurationMs:   durationMs,
		BytesWritten: totalWritten,
		SpeedMBps:    fmt.Sprintf("%.2f", speedMBps),
	}

	a.Logger.Info("WriteActivity completed",
		zap.String("jobRunId", input.JobRunID),
		zap.Int64("bytesWritten", totalWritten),
		zap.String("speedMBps", output.SpeedMBps),
	)

	return output, nil
}

// NetworkPerformanceActivity measures the network copy speed by copying a test
// file from source to target mount.
func (a *Activities) NetworkPerformanceActivity(ctx context.Context, input NetPerfInput) (*NetPerfOutput, error) {
	a.Logger.Info("NetworkPerformanceActivity started",
		zap.String("jobRunId", input.JobRunID),
	)

	sourceMountDir := filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.SourceID)
	targetMountDir := filepath.Join(a.Config.BaseWorkingPath, input.JobRunID, input.TargetID)

	sourceFile := filepath.Join(sourceMountDir, input.SourcePath, a.Config.SpeedTestFileName)
	targetFile := filepath.Join(targetMountDir, input.TargetPath, a.Config.SpeedTestFileName)

	// Ensure the source test file exists; create if needed.
	if _, err := os.Stat(sourceFile); os.IsNotExist(err) {
		totalBytes := int64(input.SizeGB * 1024 * 1024 * 1024)
		if err := createTestFile(sourceFile, totalBytes); err != nil {
			return nil, fmt.Errorf("creating source test file: %w", err)
		}
	}

	// Ensure target directory exists.
	if err := os.MkdirAll(filepath.Dir(targetFile), 0755); err != nil {
		return nil, fmt.Errorf("creating target directory: %w", err)
	}

	// Copy and measure time.
	start := time.Now()

	srcInfo, err := os.Stat(sourceFile)
	if err != nil {
		return nil, fmt.Errorf("stat source test file: %w", err)
	}

	_, err = copyFileSimple(sourceFile, targetFile)
	if err != nil {
		return nil, fmt.Errorf("copying test file: %w", err)
	}

	duration := time.Since(start)
	durationMs := duration.Milliseconds()
	if durationMs == 0 {
		durationMs = 1
	}

	speedMBps := float64(srcInfo.Size()) / (1024 * 1024) / duration.Seconds()

	output := &NetPerfOutput{
		DurationMs: durationMs,
		SpeedMBps:  fmt.Sprintf("%.2f", speedMBps),
	}

	a.Logger.Info("NetworkPerformanceActivity completed",
		zap.String("jobRunId", input.JobRunID),
		zap.String("speedMBps", output.SpeedMBps),
	)

	return output, nil
}

// PostResultsActivity posts speed test results to the report service.
func (a *Activities) PostResultsActivity(ctx context.Context, input PostResultsInput) error {
	a.Logger.Info("PostResultsActivity",
		zap.String("jobRunId", input.JobRunID),
		zap.Int("resultCount", len(input.Results)),
	)

	url := fmt.Sprintf("%s/api/v1/report/speed-test/%s", a.Config.ReportServiceURL, input.JobRunID)

	body, err := toJSON(input.Results)
	if err != nil {
		return fmt.Errorf("marshaling speed test results: %w", err)
	}

	resp, err := a.HTTP.Post(url, body, nil)
	if err != nil {
		return fmt.Errorf("posting speed test results: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("post speed test results returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// createTestFile creates a file filled with zeros of the given size.
func createTestFile(path string, size int64) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	buf := make([]byte, 1024*1024) // 1MB
	var written int64
	for written < size {
		remaining := size - written
		writeSize := int64(len(buf))
		if remaining < writeSize {
			writeSize = remaining
		}
		n, err := f.Write(buf[:writeSize])
		written += int64(n)
		if err != nil {
			return err
		}
	}

	return f.Sync()
}

// copyFileSimple copies a file from source to dest using a buffer.
func copyFileSimple(source, dest string) (int64, error) {
	srcFile, err := os.Open(source)
	if err != nil {
		return 0, err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dest)
	if err != nil {
		return 0, err
	}
	defer dstFile.Close()

	buf := make([]byte, 1024*1024)
	var total int64
	for {
		n, readErr := srcFile.Read(buf)
		if n > 0 {
			wn, writeErr := dstFile.Write(buf[:n])
			total += int64(wn)
			if writeErr != nil {
				return total, writeErr
			}
		}
		if readErr != nil {
			break
		}
	}

	return total, dstFile.Sync()
}
