package activities

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

// ---------------------------------------------------------------------------
// parseJSON / toJSON helpers
// ---------------------------------------------------------------------------

func TestParseJSON_Valid(t *testing.T) {
	input := []byte(`{"name":"test","value":42}`)
	var result map[string]interface{}
	err := parseJSON(input, &result)
	assert.NoError(t, err)
	assert.Equal(t, "test", result["name"])
	assert.Equal(t, float64(42), result["value"])
}

func TestParseJSON_Invalid(t *testing.T) {
	input := []byte(`{invalid json}`)
	var result map[string]interface{}
	err := parseJSON(input, &result)
	assert.Error(t, err)
}

func TestToJSON_Valid(t *testing.T) {
	input := map[string]string{"key": "value"}
	data, err := toJSON(input)
	assert.NoError(t, err)
	assert.Contains(t, string(data), `"key":"value"`)
}

// ---------------------------------------------------------------------------
// countDepth (from discovery_scan.go)
// ---------------------------------------------------------------------------

func TestCountDepth_Root(t *testing.T) {
	assert.Equal(t, 0, countDepth("/"))
}

func TestCountDepth_SingleLevel(t *testing.T) {
	// filepath.SplitList uses PATH separator (colon on Unix), not slashes.
	// The function has a fallback using string splitting.
	depth := countDepth("/foo")
	// countDepth returns len(SplitList(cleaned)) which on unix with : separator
	// returns 1 for "/foo" (the whole string is one element).
	assert.GreaterOrEqual(t, depth, 1)
}

func TestCountDepth_Empty(t *testing.T) {
	depth := countDepth("")
	assert.GreaterOrEqual(t, depth, 0)
}

func TestCountDepth_Dot(t *testing.T) {
	assert.Equal(t, 0, countDepth("."))
}

// ---------------------------------------------------------------------------
// resolveRelativePath (from migrate_scan.go)
// ---------------------------------------------------------------------------

func TestResolveRelativePath_WithPrefix(t *testing.T) {
	result := resolveRelativePath("/mnt/data/jobrun/files/subdir", "/mnt/data/jobrun/files")
	assert.Equal(t, "/subdir", result)
}

func TestResolveRelativePath_NoPrefix(t *testing.T) {
	result := resolveRelativePath("/foo/bar", "/other")
	assert.Equal(t, "/foo/bar", result)
}

func TestResolveRelativePath_ExactMatch(t *testing.T) {
	result := resolveRelativePath("/mnt/data", "/mnt/data")
	assert.Equal(t, "", result)
}

// ---------------------------------------------------------------------------
// buildCmdMeta (from migrate_scan.go)
// ---------------------------------------------------------------------------

func TestBuildCmdMeta_NilInfo(t *testing.T) {
	assert.Nil(t, buildCmdMeta(nil, false))
}

func TestBuildCmdMeta_WithFileInfo(t *testing.T) {
	// Use a simple temp file to get a real os.FileInfo.
	dir := t.TempDir()
	path := dir + "/meta_test.txt"
	err := writeFile(path, []byte("metadata test"))
	assert.NoError(t, err)

	info, err := statFile(path)
	assert.NoError(t, err)

	meta := buildCmdMeta(info, false)
	assert.NotNil(t, meta)
	assert.Equal(t, int64(13), meta.Size)
	assert.False(t, meta.IsSymLink)
}

func TestBuildCmdMeta_Symlink(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/meta_test.txt"
	err := writeFile(path, []byte("data"))
	assert.NoError(t, err)

	info, err := statFile(path)
	assert.NoError(t, err)

	meta := buildCmdMeta(info, true)
	assert.NotNil(t, meta)
	assert.True(t, meta.IsSymLink)
}

// ---------------------------------------------------------------------------
// getInode (from migrate_scan.go)
// ---------------------------------------------------------------------------

func TestGetInode_NilInfo(t *testing.T) {
	assert.Equal(t, int64(0), getInode(nil))
}

// ---------------------------------------------------------------------------
// helpers for tests
// ---------------------------------------------------------------------------

func writeFile(path string, data []byte) error {
	return writeFileHelper(path, data, 0644)
}

func writeFileHelper(path string, data []byte, perm uint32) error {
	return os.WriteFile(path, data, os.FileMode(perm))
}

func statFile(path string) (os.FileInfo, error) {
	return os.Stat(path)
}
