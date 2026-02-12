package activities

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/netapp/ndm/services/go-worker/auth"
	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/filecopy"
	"github.com/netapp/ndm/services/go-worker/httpclient"
	"github.com/netapp/ndm/services/go-worker/logger"
	"github.com/netapp/ndm/services/go-worker/redisclient"
	"github.com/netapp/ndm/services/go-worker/types"

	"go.temporal.io/sdk/client"
)

// Activities holds all shared dependencies required by Temporal activity
// implementations. A single instance is registered with the Temporal worker.
type Activities struct {
	Config         *config.Config
	Redis          *redisclient.RedisClient
	Auth           *auth.KeycloakAuth
	CopyPool       *filecopy.CopyPool
	HTTP           *httpclient.Client
	Logger         *logger.Logger
	TemporalClient client.Client
}

// NewDMError constructs a types.DMError representing an operation-level error.
// The category, origin, operationName, errorType, and commandID are used to
// populate the OperationError, while err provides the error message and file
// identifies the affected file.
func NewDMError(category, origin, operationName, errorType, commandID string, err error, file types.ErroredFile) types.DMError {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	return types.DMError{
		Operation: &types.OperationError{
			OperationID:   commandID,
			ErrorCode:     category,
			ErrorMessage:  errMsg,
			ErrorFiles:    file,
			ErrorType:     errorType,
			OperationName: operationName,
			Origin:        origin,
		},
	}
}

// isContentUpdate returns true when the source and target file differ in size
// or modification time, indicating the file content needs to be re-copied.
func isContentUpdate(source, target os.FileInfo) bool {
	if source.Size() != target.Size() {
		return true
	}
	if !source.ModTime().Equal(target.ModTime()) {
		return true
	}
	return false
}

// isMetaUpdated returns true when the source and target metadata differ beyond
// the allowed tolerance. This checks modification time within toleranceMs.
func isMetaUpdated(source, target os.FileInfo, toleranceMs int) bool {
	diff := source.ModTime().Sub(target.ModTime())
	if diff < 0 {
		diff = -diff
	}
	tolerance := time.Duration(toleranceMs) * time.Millisecond
	return diff > tolerance
}

// removePrefix strips the leading prefix from path. If the path does not start
// with the prefix, it is returned unchanged. The result always starts with "/".
func removePrefix(path, prefix string) string {
	if prefix == "" {
		return path
	}
	result := strings.TrimPrefix(path, prefix)
	if result == "" {
		return "/"
	}
	if !strings.HasPrefix(result, "/") {
		result = "/" + result
	}
	return result
}

// shouldExcludeOrSkip determines whether a file should be excluded from
// processing based on exclude patterns, skip-time filters, or older-than
// cutoffs. Returns true if the file should be skipped.
func shouldExcludeOrSkip(fullPath string, stats os.FileInfo, excludePatterns string, skipTime string, olderThan time.Time, jobType string) bool {
	if excludePatterns != "" {
		patterns := strings.Split(excludePatterns, ",")
		baseName := filepath.Base(fullPath)
		for _, pattern := range patterns {
			pattern = strings.TrimSpace(pattern)
			if pattern == "" {
				continue
			}
			matched, err := filepath.Match(pattern, baseName)
			if err == nil && matched {
				return true
			}
		}
	}

	if stats != nil && !stats.IsDir() {
		// Skip files modified within the skip window.
		if skipTime != "" {
			duration, err := time.ParseDuration(skipTime)
			if err == nil {
				cutoff := time.Now().Add(-duration)
				if stats.ModTime().After(cutoff) {
					return true
				}
			}
		}

		// Exclude files older than the specified time.
		if !olderThan.IsZero() && stats.ModTime().Before(olderThan) {
			return true
		}
	}

	return false
}

// shouldExcludeForDelete determines whether a file in the target should be
// excluded from deletion based on exclude patterns.
func shouldExcludeForDelete(fullPath, excludePatterns string) bool {
	if excludePatterns == "" {
		return false
	}
	patterns := strings.Split(excludePatterns, ",")
	baseName := filepath.Base(fullPath)
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		matched, err := filepath.Match(pattern, baseName)
		if err == nil && matched {
			return true
		}
	}
	return false
}

// getFileInfo builds a types.FileInfo from an os.FileInfo and its paths.
func getFileInfo(name, fullFilePath, relativePath string) types.FileInfo {
	stat, err := os.Lstat(fullFilePath)
	if err != nil {
		return types.FileInfo{
			FileName: name,
			Path:     relativePath,
		}
	}

	depth := strings.Count(relativePath, "/")
	ext := filepath.Ext(name)
	fileType := types.FileTypeFile
	if stat.IsDir() {
		fileType = types.FileTypeDirectory
	} else if stat.Mode()&os.ModeSymlink != 0 {
		fileType = types.FileTypeSymbolicLink
	}

	perm := fmt.Sprintf("%04o", stat.Mode().Perm())

	return types.FileInfo{
		FileName:     name,
		Path:         relativePath,
		ParentPath:   filepath.Dir(relativePath),
		IsDirectory:  stat.IsDir(),
		FileSize:     stat.Size(),
		IsFile:       !stat.IsDir(),
		ModifiedTime: stat.ModTime(),
		Extension:    ext,
		Permission:   perm,
		FileType:     fileType,
		Depth:        depth,
	}
}
