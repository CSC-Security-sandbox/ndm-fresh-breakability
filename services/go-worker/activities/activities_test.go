package activities

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/types"
)

// ---------------------------------------------------------------------------
// NewDMError
// ---------------------------------------------------------------------------

func TestNewDMError_WithError(t *testing.T) {
	errFile := types.ErroredFile{FileName: "file.txt", FilePath: "/src/file.txt"}
	dmErr := NewDMError("COPY_FILE_ERROR", "SOURCE", "COPY_CONTENT", "TRANSIENT_ERROR", "cmd-123", errors.New("permission denied"), errFile)

	require.NotNil(t, dmErr.Operation)
	assert.Equal(t, "cmd-123", dmErr.Operation.OperationID)
	assert.Equal(t, "COPY_FILE_ERROR", dmErr.Operation.ErrorCode)
	assert.Equal(t, "permission denied", dmErr.Operation.ErrorMessage)
	assert.Equal(t, "SOURCE", dmErr.Operation.Origin)
	assert.Equal(t, "COPY_CONTENT", dmErr.Operation.OperationName)
	assert.Equal(t, "TRANSIENT_ERROR", dmErr.Operation.ErrorType)
	assert.Equal(t, errFile, dmErr.Operation.ErrorFiles)
}

func TestNewDMError_NilError(t *testing.T) {
	errFile := types.ErroredFile{FileName: "a.txt", FilePath: "/a.txt"}
	dmErr := NewDMError("CODE", "DEST", "OP", "FATAL_ERROR", "cmd-0", nil, errFile)

	require.NotNil(t, dmErr.Operation)
	assert.Equal(t, "", dmErr.Operation.ErrorMessage, "nil error should produce empty message")
}

// ---------------------------------------------------------------------------
// isContentUpdate
// ---------------------------------------------------------------------------

func TestIsContentUpdate_SameFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "same.txt")
	require.NoError(t, os.WriteFile(path, []byte("hello"), 0644))

	info, err := os.Stat(path)
	require.NoError(t, err)

	// Same info object -> same size and mtime.
	assert.False(t, isContentUpdate(info, info))
}

func TestIsContentUpdate_DifferentSize(t *testing.T) {
	dir := t.TempDir()

	pathA := filepath.Join(dir, "a.txt")
	pathB := filepath.Join(dir, "b.txt")
	require.NoError(t, os.WriteFile(pathA, []byte("short"), 0644))
	require.NoError(t, os.WriteFile(pathB, []byte("a much longer content string"), 0644))

	infoA, err := os.Stat(pathA)
	require.NoError(t, err)
	infoB, err := os.Stat(pathB)
	require.NoError(t, err)

	assert.True(t, isContentUpdate(infoA, infoB))
}

func TestIsContentUpdate_DifferentModTime(t *testing.T) {
	dir := t.TempDir()

	pathA := filepath.Join(dir, "a.txt")
	require.NoError(t, os.WriteFile(pathA, []byte("hello"), 0644))

	infoA, err := os.Stat(pathA)
	require.NoError(t, err)

	// Change mod time.
	oldTime := time.Now().Add(-24 * time.Hour)
	require.NoError(t, os.Chtimes(pathA, oldTime, oldTime))

	infoB, err := os.Stat(pathA)
	require.NoError(t, err)

	assert.True(t, isContentUpdate(infoA, infoB))
}

// ---------------------------------------------------------------------------
// isMetaUpdated
// ---------------------------------------------------------------------------

func TestIsMetaUpdated_WithinTolerance(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))

	info, err := os.Stat(path)
	require.NoError(t, err)

	// Same info -> diff = 0, within any tolerance.
	assert.False(t, isMetaUpdated(info, info, 1000))
}

func TestIsMetaUpdated_OutsideTolerance(t *testing.T) {
	dir := t.TempDir()

	pathA := filepath.Join(dir, "a.txt")
	require.NoError(t, os.WriteFile(pathA, []byte("data"), 0644))
	infoSource, err := os.Stat(pathA)
	require.NoError(t, err)

	// Set a different mtime (2 seconds earlier).
	newTime := infoSource.ModTime().Add(-2 * time.Second)
	require.NoError(t, os.Chtimes(pathA, newTime, newTime))
	infoTarget, err := os.Stat(pathA)
	require.NoError(t, err)

	// Tolerance of 1000ms (1 second) should detect a 2-second difference.
	assert.True(t, isMetaUpdated(infoSource, infoTarget, 1000))
}

func TestIsMetaUpdated_ExactlyOnBoundary(t *testing.T) {
	dir := t.TempDir()
	pathA := filepath.Join(dir, "a.txt")
	require.NoError(t, os.WriteFile(pathA, []byte("data"), 0644))

	infoSource, err := os.Stat(pathA)
	require.NoError(t, err)

	// Set mtime exactly 5 seconds earlier.
	newTime := infoSource.ModTime().Add(-5 * time.Second)
	require.NoError(t, os.Chtimes(pathA, newTime, newTime))
	infoTarget, err := os.Stat(pathA)
	require.NoError(t, err)

	// Tolerance of 5000ms = 5 seconds. diff > tolerance => true because diff equals tolerance at boundary.
	// Actually diff == tolerance so diff > tolerance is false.
	assert.False(t, isMetaUpdated(infoSource, infoTarget, 5000))
}

// ---------------------------------------------------------------------------
// removePrefix
// ---------------------------------------------------------------------------

func TestRemovePrefix_EmptyPrefix(t *testing.T) {
	assert.Equal(t, "/foo/bar", removePrefix("/foo/bar", ""))
}

func TestRemovePrefix_PrefixMatch(t *testing.T) {
	assert.Equal(t, "/bar/baz", removePrefix("/mnt/data/bar/baz", "/mnt/data"))
}

func TestRemovePrefix_PrefixNoMatch(t *testing.T) {
	assert.Equal(t, "/other/path", removePrefix("/other/path", "/mnt/data"))
}

func TestRemovePrefix_ExactMatch(t *testing.T) {
	assert.Equal(t, "/", removePrefix("/mnt/data", "/mnt/data"))
}

func TestRemovePrefix_NoLeadingSlash(t *testing.T) {
	result := removePrefix("/mnt/dataextra", "/mnt/data")
	assert.True(t, result[0] == '/', "result should start with /")
	assert.Equal(t, "/extra", result)
}

// ---------------------------------------------------------------------------
// shouldExcludeOrSkip
// ---------------------------------------------------------------------------

func TestShouldExcludeOrSkip_NoPatterns(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	info, err := os.Stat(path)
	require.NoError(t, err)

	assert.False(t, shouldExcludeOrSkip(path, info, "", "", time.Time{}, "migration"))
}

func TestShouldExcludeOrSkip_MatchingPattern(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.log")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	info, err := os.Stat(path)
	require.NoError(t, err)

	assert.True(t, shouldExcludeOrSkip(path, info, "*.log", "", time.Time{}, "migration"))
}

func TestShouldExcludeOrSkip_NonMatchingPattern(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "readme.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	info, err := os.Stat(path)
	require.NoError(t, err)

	assert.False(t, shouldExcludeOrSkip(path, info, "*.log", "", time.Time{}, "migration"))
}

func TestShouldExcludeOrSkip_MultiplePatterns(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.bak")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	info, err := os.Stat(path)
	require.NoError(t, err)

	assert.True(t, shouldExcludeOrSkip(path, info, "*.log, *.bak, *.tmp", "", time.Time{}, "migration"))
}

func TestShouldExcludeOrSkip_SkipTime(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "recent.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	// File was just created, so it was modified recently.
	info, err := os.Stat(path)
	require.NoError(t, err)

	// Skip files modified in the last 1 hour.
	assert.True(t, shouldExcludeOrSkip(path, info, "", "1h", time.Time{}, "migration"))
}

func TestShouldExcludeOrSkip_SkipTime_OldFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "old.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	// Set the file modification time to 2 hours ago.
	oldTime := time.Now().Add(-2 * time.Hour)
	require.NoError(t, os.Chtimes(path, oldTime, oldTime))
	info, err := os.Stat(path)
	require.NoError(t, err)

	// Skip files modified in the last 1 hour -> this file is older, should not skip.
	assert.False(t, shouldExcludeOrSkip(path, info, "", "1h", time.Time{}, "migration"))
}

func TestShouldExcludeOrSkip_OlderThan(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ancient.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	// Set mod time to 10 days ago.
	oldTime := time.Now().Add(-10 * 24 * time.Hour)
	require.NoError(t, os.Chtimes(path, oldTime, oldTime))
	info, err := os.Stat(path)
	require.NoError(t, err)

	// Exclude files older than 5 days ago.
	cutoff := time.Now().Add(-5 * 24 * time.Hour)
	assert.True(t, shouldExcludeOrSkip(path, info, "", "", cutoff, "migration"))
}

func TestShouldExcludeOrSkip_OlderThan_RecentFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "new.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	info, err := os.Stat(path)
	require.NoError(t, err)

	cutoff := time.Now().Add(-5 * 24 * time.Hour)
	assert.False(t, shouldExcludeOrSkip(path, info, "", "", cutoff, "migration"))
}

func TestShouldExcludeOrSkip_DirectoryIgnoresSkipTime(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "subdir")
	require.NoError(t, os.Mkdir(subDir, 0755))
	info, err := os.Stat(subDir)
	require.NoError(t, err)

	// Directories should not be affected by skipTime or olderThan (stats.IsDir() check).
	assert.False(t, shouldExcludeOrSkip(subDir, info, "", "1h", time.Time{}, "migration"))
}

// ---------------------------------------------------------------------------
// shouldExcludeForDelete
// ---------------------------------------------------------------------------

func TestShouldExcludeForDelete_EmptyPatterns(t *testing.T) {
	assert.False(t, shouldExcludeForDelete("/target/file.txt", ""))
}

func TestShouldExcludeForDelete_Matching(t *testing.T) {
	assert.True(t, shouldExcludeForDelete("/target/data.log", "*.log"))
}

func TestShouldExcludeForDelete_NonMatching(t *testing.T) {
	assert.False(t, shouldExcludeForDelete("/target/data.txt", "*.log"))
}

func TestShouldExcludeForDelete_MultiplePatterns(t *testing.T) {
	assert.True(t, shouldExcludeForDelete("/target/data.bak", "*.log, *.bak"))
	assert.False(t, shouldExcludeForDelete("/target/data.csv", "*.log, *.bak"))
}

// ---------------------------------------------------------------------------
// getFileInfo
// ---------------------------------------------------------------------------

func TestGetFileInfo_RegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	require.NoError(t, os.WriteFile(path, []byte("hello world"), 0644))

	fi := getFileInfo("test.txt", path, "/data/test.txt")

	assert.Equal(t, "test.txt", fi.FileName)
	assert.Equal(t, "/data/test.txt", fi.Path)
	assert.Equal(t, "/data", fi.ParentPath)
	assert.False(t, fi.IsDirectory)
	assert.True(t, fi.IsFile)
	assert.Equal(t, int64(11), fi.FileSize)
	assert.Equal(t, ".txt", fi.Extension)
	assert.Equal(t, types.FileTypeFile, fi.FileType)
	assert.Equal(t, 2, fi.Depth) // /data/test.txt has 2 slashes
	assert.NotEmpty(t, fi.Permission)
}

func TestGetFileInfo_Directory(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "mydir")
	require.NoError(t, os.Mkdir(subDir, 0755))

	fi := getFileInfo("mydir", subDir, "/data/mydir")

	assert.Equal(t, "mydir", fi.FileName)
	assert.True(t, fi.IsDirectory)
	assert.False(t, fi.IsFile)
	assert.Equal(t, types.FileTypeDirectory, fi.FileType)
}

func TestGetFileInfo_NonExistentPath(t *testing.T) {
	fi := getFileInfo("ghost.txt", "/nonexistent/path/ghost.txt", "/rel/ghost.txt")

	assert.Equal(t, "ghost.txt", fi.FileName)
	assert.Equal(t, "/rel/ghost.txt", fi.Path)
	// No other fields should be populated since stat fails.
	assert.Equal(t, int64(0), fi.FileSize)
}

func TestGetFileInfo_Symlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.txt")
	require.NoError(t, os.WriteFile(target, []byte("link target"), 0644))

	link := filepath.Join(dir, "link.txt")
	require.NoError(t, os.Symlink(target, link))

	// getFileInfo uses Lstat, so it should detect the symlink.
	fi := getFileInfo("link.txt", link, "/data/link.txt")
	assert.Equal(t, "link.txt", fi.FileName)
	assert.Equal(t, types.FileTypeSymbolicLink, fi.FileType)
}
