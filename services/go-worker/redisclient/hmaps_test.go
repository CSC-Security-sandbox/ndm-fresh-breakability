package redisclient

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vmihailenco/msgpack/v5"
)

func TestEncodeHMapValue_String(t *testing.T) {
	encoded, err := encodeHMapValue("hello")
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	// Verify we can decode it back
	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded string
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Equal(t, "hello", decoded)
}

func TestEncodeHMapValue_Int(t *testing.T) {
	encoded, err := encodeHMapValue(42)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded int
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Equal(t, 42, decoded)
}

func TestEncodeHMapValue_Struct(t *testing.T) {
	type TestData struct {
		Name  string `msgpack:"name"`
		Count int    `msgpack:"count"`
	}

	original := TestData{Name: "test", Count: 5}
	encoded, err := encodeHMapValue(original)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded TestData
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Equal(t, original, decoded)
}

func TestEncodeHMapValue_Map(t *testing.T) {
	original := map[string]string{
		"key1": "val1",
		"key2": "val2",
	}

	encoded, err := encodeHMapValue(original)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded map[string]string
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Equal(t, original, decoded)
}

func TestEncodeHMapValue_Nil(t *testing.T) {
	encoded, err := encodeHMapValue(nil)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	// Should decode to nil/null
	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded interface{}
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Nil(t, decoded)
}

func TestEncodeHMapValue_EmptyString(t *testing.T) {
	encoded, err := encodeHMapValue("")
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded string
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Equal(t, "", decoded)
}

func TestEncodeHMapValue_Bool(t *testing.T) {
	encoded, err := encodeHMapValue(true)
	require.NoError(t, err)

	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded bool
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.True(t, decoded)
}

func TestEncodeHMapValue_Slice(t *testing.T) {
	original := []int{1, 2, 3, 4, 5}

	encoded, err := encodeHMapValue(original)
	require.NoError(t, err)

	raw, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)

	var decoded []int
	err = msgpack.Unmarshal(raw, &decoded)
	require.NoError(t, err)
	assert.Equal(t, original, decoded)
}
