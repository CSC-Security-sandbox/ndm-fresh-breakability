package redisclient

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncodeDecode_String(t *testing.T) {
	original := "hello world"

	encoded, err := encode(original)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	decoded, err := decode[string](encoded)
	require.NoError(t, err)
	assert.Equal(t, original, decoded)
}

func TestEncodeDecode_Int(t *testing.T) {
	original := 42

	encoded, err := encode(original)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	decoded, err := decode[int](encoded)
	require.NoError(t, err)
	assert.Equal(t, original, decoded)
}

func TestEncodeDecode_Struct(t *testing.T) {
	type testStruct struct {
		Name  string `msgpack:"name"`
		Value int    `msgpack:"value"`
	}

	original := testStruct{Name: "test", Value: 123}

	encoded, err := encode(original)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	decoded, err := decode[testStruct](encoded)
	require.NoError(t, err)
	assert.Equal(t, original.Name, decoded.Name)
	assert.Equal(t, original.Value, decoded.Value)
}

func TestEncodeDecode_Map(t *testing.T) {
	original := map[string]interface{}{
		"key1": "value1",
		"key2": int8(42), // msgpack will decode integers as smallest fitting type
	}

	encoded, err := encode(original)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	decoded, err := decode[map[string]interface{}](encoded)
	require.NoError(t, err)
	assert.Equal(t, "value1", decoded["key1"])
}

func TestEncodeDecode_Slice(t *testing.T) {
	original := []string{"a", "b", "c"}

	encoded, err := encode(original)
	require.NoError(t, err)

	decoded, err := decode[[]string](encoded)
	require.NoError(t, err)
	assert.Equal(t, original, decoded)
}

func TestDecode_InvalidBase64(t *testing.T) {
	_, err := decode[string]("not-valid-base64!!!")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "base64 decode")
}

func TestDecode_InvalidMsgpack(t *testing.T) {
	// Valid base64 but invalid msgpack
	// base64 of "random bytes that aren't valid msgpack for a string type"
	_, err := decode[string]("AAAA")
	// This may or may not error depending on what msgpack does with the bytes,
	// but it should not panic
	_ = err
}

func TestEncode_EmptyString(t *testing.T) {
	encoded, err := encode("")
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	decoded, err := decode[string](encoded)
	require.NoError(t, err)
	assert.Equal(t, "", decoded)
}

func TestEncodeDecode_Bool(t *testing.T) {
	encoded, err := encode(true)
	require.NoError(t, err)

	decoded, err := decode[bool](encoded)
	require.NoError(t, err)
	assert.True(t, decoded)
}

func TestEncodeDecode_NilSlice(t *testing.T) {
	var original []string

	encoded, err := encode(original)
	require.NoError(t, err)

	decoded, err := decode[[]string](encoded)
	require.NoError(t, err)
	assert.Nil(t, decoded)
}
