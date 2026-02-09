package activities

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/redisclient"
	"github.com/netapp/ndm/services/go-worker/types"
)

// DiscoveryScanDirectory scans a source directory for discovery purposes.
// Unlike MigrateScanDirectory, it does not compare with a target directory
// and only publishes file information to the file stream (no commands).
func (a *Activities) DiscoveryScanDirectory(
	jobContext *redisclient.JobManagerContext,
	sourcePath, sourcePrefix string,
	command types.Cmd,
	excludePatterns string,
	skipFile string,
	olderThan time.Time,
	errorType string,
) (*ScanDirectoryOutput, error) {
	ctx := context.Background()
	output := &ScanDirectoryOutput{
		SubDirs: make([]string, 0),
	}

	// Read source directory entries.
	entries, err := os.ReadDir(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("reading source directory %s: %w", sourcePath, err)
	}

	// Buffer for file info items.
	fileInfoBuf := make([]types.ItemInfo, 0, len(entries))

	for _, entry := range entries {
		name := entry.Name()
		fullPath := filepath.Join(sourcePath, name)

		// Get file info.
		info, err := entry.Info()
		if err != nil {
			a.Logger.Error("failed to get file info for discovery",
				zap.String("path", fullPath),
				zap.Error(err),
			)
			continue
		}

		relativePath := removePrefix(fullPath, sourcePrefix)

		// Check exclusions.
		if shouldExcludeOrSkip(fullPath, info, excludePatterns, skipFile, olderThan, types.JobTypeDiscovery) {
			continue
		}

		// Check for symlink.
		lstatInfo, lstatErr := os.Lstat(fullPath)
		isSymlink := lstatErr == nil && lstatInfo.Mode()&os.ModeSymlink != 0

		if entry.IsDir() && !isSymlink {
			output.DirCount++
			output.SubDirs = append(output.SubDirs, relativePath)
		} else {
			output.FileCount++
		}

		// Build item info for publishing.
		ext := filepath.Ext(name)
		fileType := types.FileTypeFile
		if entry.IsDir() && !isSymlink {
			fileType = types.FileTypeDirectory
		} else if isSymlink {
			fileType = types.FileTypeSymbolicLink
		}

		depth := countDepth(relativePath)
		perm := fmt.Sprintf("%04o", info.Mode().Perm())

		item := types.ItemInfo{
			FileName:       name,
			IsDirectory:    entry.IsDir() && !isSymlink,
			IsSymbolicLink: isSymlink,
			Depth:          depth,
			Extension:      ext,
			FileType:       fileType,
			Size:           info.Size(),
			SourceMeta: types.ItemMeta{
				ModifiedTime: info.ModTime(),
				Permission:   perm,
			},
		}

		fileInfoBuf = append(fileInfoBuf, item)
	}

	// Publish file info in bulk.
	if len(fileInfoBuf) > 0 {
		if err := jobContext.PublishToFileStreamBulk(ctx, fileInfoBuf); err != nil {
			a.Logger.Error("failed to publish file info batch",
				zap.String("sourcePath", sourcePath),
				zap.Error(err),
			)
		}
	}

	return output, nil
}

// countDepth returns the number of path segments (depth) in a relative path.
func countDepth(relativePath string) int {
	cleaned := filepath.Clean(relativePath)
	if cleaned == "/" || cleaned == "." {
		return 0
	}
	// Count separators.
	parts := filepath.SplitList(cleaned)
	if len(parts) == 0 {
		// Use string splitting as fallback.
		trimmed := relativePath
		if len(trimmed) > 0 && trimmed[0] == '/' {
			trimmed = trimmed[1:]
		}
		if trimmed == "" {
			return 0
		}
		return len(filepath.SplitList(trimmed))
	}
	return len(parts)
}
