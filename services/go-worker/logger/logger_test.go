package logger

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewLogger(t *testing.T) {
	l := NewLogger("test-service")
	require.NotNil(t, l)
	assert.NotNil(t, l.zap)
}

func TestNewLogger_DifferentNames(t *testing.T) {
	l1 := NewLogger("service-a")
	l2 := NewLogger("service-b")
	require.NotNil(t, l1)
	require.NotNil(t, l2)
	// Both should be valid but distinct logger instances
	assert.NotSame(t, l1, l2)
}

func TestWithTrackID(t *testing.T) {
	l := NewLogger("test")
	tracked := l.WithTrackID("trace-123")

	require.NotNil(t, tracked)
	// The new logger should have context fields
	assert.Len(t, tracked.context, 1)
	assert.Equal(t, "trackId", tracked.context[0].Key)

	// Original logger should be unmodified
	assert.Nil(t, l.context)
}

func TestWithTrackID_ChainedCalls(t *testing.T) {
	l := NewLogger("test")
	tracked1 := l.WithTrackID("trace-1")
	tracked2 := tracked1.WithTrackID("trace-2")

	// tracked2 should have two context fields (both trackId entries)
	assert.Len(t, tracked2.context, 2)
	// tracked1 should still have one
	assert.Len(t, tracked1.context, 1)
	// Original should have none
	assert.Nil(t, l.context)
}

func TestMaskIPs_SingleIP(t *testing.T) {
	result := MaskIPs("192.168.1.100")
	assert.Equal(t, "192.168.1.***", result)
}

func TestMaskIPs_MultipleIPs(t *testing.T) {
	result := MaskIPs("connect from 10.0.0.5 to 172.16.0.99")
	assert.Equal(t, "connect from 10.0.0.*** to 172.16.0.***", result)
}

func TestMaskIPs_NoIPs(t *testing.T) {
	result := MaskIPs("no ip addresses here")
	assert.Equal(t, "no ip addresses here", result)
}

func TestMaskIPs_EmptyString(t *testing.T) {
	result := MaskIPs("")
	assert.Equal(t, "", result)
}

func TestMaskIPs_IPInURL(t *testing.T) {
	result := MaskIPs("http://192.168.1.50:8080/api")
	assert.Equal(t, "http://192.168.1.***:8080/api", result)
}

func TestMaskIPs_PreservesNonIPText(t *testing.T) {
	result := MaskIPs("host=192.168.0.1, port=8080, status=ok")
	assert.Equal(t, "host=192.168.0.***, port=8080, status=ok", result)
}

func TestLogger_Underlying(t *testing.T) {
	l := NewLogger("test")
	underlying := l.Underlying()
	assert.NotNil(t, underlying)
}

func TestLogger_MergeFields_EmptyContext(t *testing.T) {
	l := NewLogger("test")
	// With no context, mergeFields should return the input fields as-is
	fields := l.mergeFields(nil)
	assert.Empty(t, fields)
}

func TestLogger_LogMethods_DoNotPanic(t *testing.T) {
	l := NewLogger("test")

	// These should not panic
	assert.NotPanics(t, func() {
		l.Info("test info message")
	})
	assert.NotPanics(t, func() {
		l.Error("test error message")
	})
	assert.NotPanics(t, func() {
		l.Debug("test debug message")
	})
	assert.NotPanics(t, func() {
		l.Warn("test warn message")
	})
}

func TestLogger_Sync_DoesNotPanic(t *testing.T) {
	l := NewLogger("test")
	// Sync might return an error on stdout, but should not panic
	assert.NotPanics(t, func() {
		_ = l.Sync()
	})
}
