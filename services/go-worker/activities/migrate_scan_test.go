package activities

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/types"
)

// ---------------------------------------------------------------------------
// buildCmdMeta with real files
// ---------------------------------------------------------------------------

func TestBuildCmdMeta_RegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file.dat")
	require.NoError(t, os.WriteFile(path, []byte("abcdefg"), 0644))

	info, err := os.Stat(path)
	require.NoError(t, err)

	meta := buildCmdMeta(info, false)
	require.NotNil(t, meta)
	assert.Equal(t, int64(7), meta.Size)
	assert.False(t, meta.IsSymLink)
	assert.Equal(t, int(os.FileMode(0644).Perm()), meta.Mode)
	assert.False(t, meta.Mtime.IsZero())
}

func TestBuildCmdMeta_Directory(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "sub")
	require.NoError(t, os.Mkdir(subDir, 0755))

	info, err := os.Stat(subDir)
	require.NoError(t, err)

	meta := buildCmdMeta(info, false)
	require.NotNil(t, meta)
	assert.False(t, meta.IsSymLink)
}

// ---------------------------------------------------------------------------
// getInode with real files
// ---------------------------------------------------------------------------

func TestGetInode_RegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "inode.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))

	info, err := os.Stat(path)
	require.NoError(t, err)

	inode := getInode(info)
	// On most platforms this returns >= 0; on darwin/linux it should be > 0.
	assert.GreaterOrEqual(t, inode, int64(0))
}

// ---------------------------------------------------------------------------
// Integration-like test: content update detection
// ---------------------------------------------------------------------------

func TestIsContentUpdate_Integration(t *testing.T) {
	dir := t.TempDir()

	srcPath := filepath.Join(dir, "src.dat")
	tgtPath := filepath.Join(dir, "tgt.dat")

	require.NoError(t, os.WriteFile(srcPath, []byte("source data"), 0644))
	require.NoError(t, os.WriteFile(tgtPath, []byte("source data"), 0644))

	// Set same mod time.
	mtime := time.Now().Add(-1 * time.Hour)
	require.NoError(t, os.Chtimes(srcPath, mtime, mtime))
	require.NoError(t, os.Chtimes(tgtPath, mtime, mtime))

	srcInfo, err := os.Stat(srcPath)
	require.NoError(t, err)
	tgtInfo, err := os.Stat(tgtPath)
	require.NoError(t, err)

	// Same size and mtime -> no update needed.
	assert.False(t, isContentUpdate(srcInfo, tgtInfo))

	// Now modify the source file content (different size).
	require.NoError(t, os.WriteFile(srcPath, []byte("modified source data!!"), 0644))
	require.NoError(t, os.Chtimes(srcPath, mtime, mtime))

	srcInfo, err = os.Stat(srcPath)
	require.NoError(t, err)

	assert.True(t, isContentUpdate(srcInfo, tgtInfo))
}

// ---------------------------------------------------------------------------
// Integration-like test: meta update detection
// ---------------------------------------------------------------------------

func TestIsMetaUpdated_Integration(t *testing.T) {
	dir := t.TempDir()

	srcPath := filepath.Join(dir, "src_meta.dat")
	tgtPath := filepath.Join(dir, "tgt_meta.dat")

	require.NoError(t, os.WriteFile(srcPath, []byte("data"), 0644))
	require.NoError(t, os.WriteFile(tgtPath, []byte("data"), 0644))

	baseTime := time.Now().Add(-1 * time.Hour)
	require.NoError(t, os.Chtimes(srcPath, baseTime, baseTime))
	require.NoError(t, os.Chtimes(tgtPath, baseTime, baseTime))

	srcInfo, err := os.Stat(srcPath)
	require.NoError(t, err)
	tgtInfo, err := os.Stat(tgtPath)
	require.NoError(t, err)

	// Same time -> no meta update.
	assert.False(t, isMetaUpdated(srcInfo, tgtInfo, 30000))

	// Shift target mtime by 31 seconds (31000ms > 30000ms tolerance).
	shiftedTime := baseTime.Add(31 * time.Second)
	require.NoError(t, os.Chtimes(tgtPath, shiftedTime, shiftedTime))
	tgtInfo, err = os.Stat(tgtPath)
	require.NoError(t, err)

	assert.True(t, isMetaUpdated(srcInfo, tgtInfo, 30000))
}

// ---------------------------------------------------------------------------
// Exclusion patterns integration
// ---------------------------------------------------------------------------

func TestShouldExcludeOrSkip_WithDirectory(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "node_modules")
	require.NoError(t, os.Mkdir(subDir, 0755))
	info, err := os.Stat(subDir)
	require.NoError(t, err)

	// Pattern matching applies to directories too.
	assert.True(t, shouldExcludeOrSkip(subDir, info, "node_modules", "", time.Time{}, types.JobTypeMigration))
}

func TestShouldExcludeOrSkip_EmptyPatternInList(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))
	info, err := os.Stat(path)
	require.NoError(t, err)

	// Leading/trailing commas produce empty patterns that should be skipped.
	assert.False(t, shouldExcludeOrSkip(path, info, ",,,", "", time.Time{}, types.JobTypeMigration))
}
