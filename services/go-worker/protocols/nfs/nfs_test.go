package nfs

import (
	"errors"
	"fmt"
	"net"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseExports_WithSampleOutput(t *testing.T) {
	output := `Export list for nfs-server:
/export/data   *
/export/home   192.168.1.0/24
/shared        (everyone)
`
	exports := ParseExports(output)
	require.Len(t, exports, 3)
	assert.Equal(t, "/export/data", exports[0])
	assert.Equal(t, "/export/home", exports[1])
	assert.Equal(t, "/shared", exports[2])
}

func TestParseExports_ExcludesRoot(t *testing.T) {
	output := `/            *
/data        *
`
	exports := ParseExports(output)
	require.Len(t, exports, 1)
	assert.Equal(t, "/data", exports[0])
}

func TestParseExports_EmptyOutput(t *testing.T) {
	exports := ParseExports("")
	assert.Nil(t, exports)
}

func TestParseExports_NoExports(t *testing.T) {
	output := `Export list for nfs-server:
No exports found
`
	exports := ParseExports(output)
	assert.Nil(t, exports)
}

func TestParseExports_OnlyHeaderLine(t *testing.T) {
	output := `Export list for nfs-server:`
	exports := ParseExports(output)
	assert.Nil(t, exports)
}

func TestParseExports_SingleExport(t *testing.T) {
	output := `/mnt/share  *`
	exports := ParseExports(output)
	require.Len(t, exports, 1)
	assert.Equal(t, "/mnt/share", exports[0])
}

func TestParseProtocolVersions(t *testing.T) {
	output := `    100003    2   tcp  2049  nfs
    100003    3   tcp  2049  nfs
    100003    4   tcp  2049  nfs
    100005    1   tcp  20048  mountd
    100005    2   tcp  20048  mountd
`
	versions := ParseProtocolVersions(output)
	require.Len(t, versions, 3)
	assert.Equal(t, "2", versions[0])
	assert.Equal(t, "3", versions[1])
	assert.Equal(t, "4", versions[2])
}

func TestParseProtocolVersions_EmptyOutput(t *testing.T) {
	versions := ParseProtocolVersions("")
	assert.Nil(t, versions)
}

func TestParseProtocolVersions_NoNFSLines(t *testing.T) {
	output := `    100005    1   tcp  20048  mountd
    100005    2   tcp  20048  mountd
`
	versions := ParseProtocolVersions(output)
	assert.Nil(t, versions)
}

func TestHandleConnectionError_Nil(t *testing.T) {
	result := HandleConnectionError(nil)
	assert.Nil(t, result)
}

func TestHandleConnectionError_EACCES(t *testing.T) {
	err := HandleConnectionError(syscall.EACCES)
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Permission denied")
}

func TestHandleConnectionError_ECONNREFUSED(t *testing.T) {
	err := HandleConnectionError(syscall.ECONNREFUSED)
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Connection refused")
}

func TestHandleConnectionError_ECONNRESET(t *testing.T) {
	err := HandleConnectionError(syscall.ECONNRESET)
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Connection reset")
}

func TestHandleConnectionError_EHOSTUNREACH(t *testing.T) {
	err := HandleConnectionError(syscall.EHOSTUNREACH)
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "unreachable")
}

func TestHandleConnectionError_ENETUNREACH(t *testing.T) {
	err := HandleConnectionError(syscall.ENETUNREACH)
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Network unreachable")
}

func TestHandleConnectionError_ETIMEDOUT(t *testing.T) {
	err := HandleConnectionError(syscall.ETIMEDOUT)
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "timed out")
}

func TestHandleConnectionError_NoSuchHost(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("lookup nonexistent: no such host"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestHandleConnectionError_ConnectionRefusedString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("connection refused by server"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Connection refused")
}

func TestHandleConnectionError_TimedOutString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("operation timed out"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "timed out")
}

func TestHandleConnectionError_TimeoutString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("request timeout"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "timed out")
}

func TestHandleConnectionError_PermissionDeniedString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("permission denied"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Permission denied")
}

func TestHandleConnectionError_ConnectionResetString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("connection reset by peer"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Connection reset")
}

func TestHandleConnectionError_NetworkUnreachableString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("network is unreachable"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Network unreachable")
}

func TestHandleConnectionError_PortBlocked(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("port 2049 is blocked"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestHandleConnectionError_UnknownError(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("some unknown error"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "Unexpected error")
}

func TestHandleConnectionError_OpError(t *testing.T) {
	opErr := &net.OpError{
		Op:  "dial",
		Net: "tcp",
		Addr: &net.TCPAddr{
			IP:   net.ParseIP("192.168.1.1"),
			Port: 2049,
		},
		Err: errors.New("some unknown error"),
	}

	result := HandleConnectionError(opErr)
	require.NotNil(t, result)
	assert.Contains(t, result.Error(), "192.168.1.1")
}

func TestHandleConnectionError_HostUnreachableString(t *testing.T) {
	err := HandleConnectionError(fmt.Errorf("host is unreachable"))
	require.NotNil(t, err)
	assert.Contains(t, err.Error(), "unreachable")
}
