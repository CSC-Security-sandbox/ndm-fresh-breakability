package smb

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseLinuxShares_WithSampleOutput(t *testing.T) {
	output := `
	Sharename       Type      Comment
	---------       ----      -------
	data            Disk      Data share
	backups         Disk      Backup files
	IPC$            IPC       IPC Service
	print$          Printer   Printer Drivers
`
	shares := parseLinuxShares(output)
	require.Len(t, shares, 2)
	assert.Equal(t, "/data", shares[0])
	assert.Equal(t, "/backups", shares[1])
}

func TestParseLinuxShares_EmptyOutput(t *testing.T) {
	shares := parseLinuxShares("")
	assert.Nil(t, shares)
}

func TestParseLinuxShares_NoSharenameHeader(t *testing.T) {
	output := `Some random output without Sharename header`
	shares := parseLinuxShares(output)
	assert.Nil(t, shares)
}

func TestParseLinuxShares_OnlySystemShares(t *testing.T) {
	output := `
	Sharename       Type      Comment
	---------       ----      -------
	IPC$            IPC       IPC Service
	print$          Printer   Printer Drivers
	ADMIN$          Disk      Remote Admin
`
	shares := parseLinuxShares(output)
	// IPC$ is filtered by type (IPC, not Disk)
	// print$ is filtered by type (Printer, not Disk)
	// ADMIN$ ends with $ so it's filtered by irrelevant regex
	assert.Empty(t, shares)
}

func TestParseLinuxShares_MixedShares(t *testing.T) {
	output := `
	Sharename       Type      Comment
	---------       ----      -------
	public          Disk      Public files
	IPC$            IPC       IPC Service
	private         Disk      Private files
	C$              Disk      Default share
`
	shares := parseLinuxShares(output)
	require.Len(t, shares, 2)
	assert.Equal(t, "/public", shares[0])
	assert.Equal(t, "/private", shares[1])
}

func TestParseLinuxShares_PrefixesWithSlash(t *testing.T) {
	output := `
	Sharename       Type      Comment
	---------       ----      -------
	myshare         Disk      My Share
`
	shares := parseLinuxShares(output)
	require.Len(t, shares, 1)
	assert.Equal(t, "/myshare", shares[0])
}

func TestHandleConnectionError_AccessDenied(t *testing.T) {
	result := handleConnectionError("NT_STATUS_ACCESS_DENIED")
	assert.Contains(t, result, "Unable to connect")
	assert.Contains(t, result, "NT_STATUS_ACCESS_DENIED")
}

func TestHandleConnectionError_ConnectionRefused(t *testing.T) {
	result := handleConnectionError("NT_STATUS_CONNECTION_REFUSED")
	assert.Contains(t, result, "Not a valid SMB server")
	assert.Contains(t, result, "NT_STATUS_CONNECTION_REFUSED")
}

func TestHandleConnectionError_LogonFailure(t *testing.T) {
	result := handleConnectionError("NT_STATUS_LOGON_FAILURE")
	assert.Contains(t, result, "Wrong credentials")
	assert.Contains(t, result, "NT_STATUS_LOGON_FAILURE")
}

func TestHandleConnectionError_IOTimeout(t *testing.T) {
	result := handleConnectionError("NT_STATUS_IO_TIMEOUT")
	assert.Contains(t, result, "Unable to connect")
	assert.Contains(t, result, "NT_STATUS_IO_TIMEOUT")
}

func TestHandleConnectionError_InvalidNetworkResponse(t *testing.T) {
	result := handleConnectionError("NT_STATUS_INVALID_NETWORK_RESPONSE")
	assert.Contains(t, result, "Protocol not supported")
	assert.Contains(t, result, "NT_STATUS_INVALID_NETWORK_RESPONSE")
}

func TestHandleConnectionError_NetworkUnreachable(t *testing.T) {
	result := handleConnectionError("NT_STATUS_NETWORK_UNREACHABLE")
	assert.Contains(t, result, "Network unreachable")
	assert.Contains(t, result, "NT_STATUS_NETWORK_UNREACHABLE")
}

func TestHandleConnectionError_HostUnreachable(t *testing.T) {
	result := handleConnectionError("NT_STATUS_HOST_UNREACHABLE")
	assert.Contains(t, result, "Host unreachable")
	assert.Contains(t, result, "NT_STATUS_HOST_UNREACHABLE")
}

func TestHandleConnectionError_PortUnreachable(t *testing.T) {
	result := handleConnectionError("NT_STATUS_PORT_UNREACHABLE")
	assert.Contains(t, result, "Protocol port blocked")
	assert.Contains(t, result, "NT_STATUS_PORT_UNREACHABLE")
}

func TestHandleConnectionError_UnknownCode(t *testing.T) {
	result := handleConnectionError("NT_STATUS_SOMETHING_UNKNOWN")
	assert.Contains(t, result, "Unable to connect")
	assert.Contains(t, result, "NT_STATUS_SOMETHING_UNKNOWN")
}

func TestHandleConnectionError_AllKnownCodes(t *testing.T) {
	codes := []string{
		"NT_STATUS_ACCESS_DENIED",
		"NT_STATUS_CONNECTION_REFUSED",
		"NT_STATUS_LOGON_FAILURE",
		"NT_STATUS_IO_TIMEOUT",
		"NT_STATUS_INVALID_NETWORK_RESPONSE",
		"NT_STATUS_NETWORK_UNREACHABLE",
		"NT_STATUS_HOST_UNREACHABLE",
		"NT_STATUS_PORT_UNREACHABLE",
	}

	for _, code := range codes {
		t.Run(code, func(t *testing.T) {
			result := handleConnectionError(code)
			assert.NotEmpty(t, result)
			assert.Contains(t, result, code)
		})
	}
}
