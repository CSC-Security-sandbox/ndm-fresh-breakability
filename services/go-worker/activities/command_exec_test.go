package activities

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/logger"
)

// ---------------------------------------------------------------------------
// execCopySymlink
// ---------------------------------------------------------------------------

func newTestActivities() *Activities {
	return &Activities{
		Logger: logger.NewLogger("test", "debug"),
	}
}

func TestExecCopySymlink_Success(t *testing.T) {
	a := newTestActivities()
	dir := t.TempDir()

	// Create source file and symlink.
	sourceFile := filepath.Join(dir, "source", "target.txt")
	require.NoError(t, os.MkdirAll(filepath.Dir(sourceFile), 0755))
	require.NoError(t, os.WriteFile(sourceFile, []byte("content"), 0644))

	sourceLink := filepath.Join(dir, "source", "link.txt")
	require.NoError(t, os.Symlink(sourceFile, sourceLink))

	targetLink := filepath.Join(dir, "target", "link.txt")

	err := a.execCopySymlink(sourceLink, targetLink)
	require.NoError(t, err)

	// Verify the target symlink was created.
	linkTarget, err := os.Readlink(targetLink)
	require.NoError(t, err)
	assert.Equal(t, sourceFile, linkTarget)
}

func TestExecCopySymlink_OverwriteExisting(t *testing.T) {
	a := newTestActivities()
	dir := t.TempDir()

	// Create source symlink.
	sourceFile := filepath.Join(dir, "real.txt")
	require.NoError(t, os.WriteFile(sourceFile, []byte("content"), 0644))

	sourceLink := filepath.Join(dir, "source_link")
	require.NoError(t, os.Symlink(sourceFile, sourceLink))

	// Create an existing target file that should be replaced.
	targetDir := filepath.Join(dir, "targetdir")
	require.NoError(t, os.MkdirAll(targetDir, 0755))
	targetLink := filepath.Join(targetDir, "source_link")
	require.NoError(t, os.WriteFile(targetLink, []byte("old content"), 0644))

	err := a.execCopySymlink(sourceLink, targetLink)
	require.NoError(t, err)

	// Verify target is now a symlink.
	linkTarget, err := os.Readlink(targetLink)
	require.NoError(t, err)
	assert.Equal(t, sourceFile, linkTarget)
}

func TestExecCopySymlink_SourceNotSymlink(t *testing.T) {
	a := newTestActivities()
	dir := t.TempDir()

	regularFile := filepath.Join(dir, "regular.txt")
	require.NoError(t, os.WriteFile(regularFile, []byte("content"), 0644))

	target := filepath.Join(dir, "target_link")

	err := a.execCopySymlink(regularFile, target)
	assert.Error(t, err, "reading a non-symlink should fail")
}

// ---------------------------------------------------------------------------
// execCopyDir
// ---------------------------------------------------------------------------

func TestExecCopyDir_CreatesDirectory(t *testing.T) {
	a := newTestActivities()
	dir := t.TempDir()

	targetDir := filepath.Join(dir, "new", "nested", "dir")
	err := a.execCopyDir(targetDir)
	require.NoError(t, err)

	stat, err := os.Stat(targetDir)
	require.NoError(t, err)
	assert.True(t, stat.IsDir())
}

func TestExecCopyDir_AlreadyExists(t *testing.T) {
	a := newTestActivities()
	dir := t.TempDir()

	// Creating the same directory again should not error.
	err := a.execCopyDir(dir)
	require.NoError(t, err)
}

// ---------------------------------------------------------------------------
// File removal (tested via os.Remove logic in ExecuteCommand)
// ---------------------------------------------------------------------------

func TestRemoveFile_WithTempFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "removeme.txt")
	require.NoError(t, os.WriteFile(path, []byte("data"), 0644))

	// Verify file exists.
	_, err := os.Stat(path)
	require.NoError(t, err)

	// Remove the file.
	err = os.Remove(path)
	require.NoError(t, err)

	// Verify file is gone.
	_, err = os.Stat(path)
	assert.True(t, os.IsNotExist(err))
}

func TestRemoveDir_WithTempDir(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "subdir")
	require.NoError(t, os.MkdirAll(subDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(subDir, "file.txt"), []byte("data"), 0644))

	err := os.RemoveAll(subDir)
	require.NoError(t, err)

	_, err = os.Stat(subDir)
	assert.True(t, os.IsNotExist(err))
}

func TestRemoveFile_NonExistent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent.txt")

	err := os.Remove(path)
	assert.True(t, os.IsNotExist(err))
}
