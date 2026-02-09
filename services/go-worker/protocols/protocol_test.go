package protocols

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
)

func TestSubstitutePlaceholders_AllTokens(t *testing.T) {
	payload := ProtocolPayload{
		Hostname:        "server.example.com",
		Username:        "admin",
		Password:        "secret123",
		Path:            "/share/data",
		MountBasePath:   "/mnt/base",
		JobRunID:        "run-1",
		PathID:          "path-1",
		ProtocolVersion: "3.0",
	}

	pattern := "mount -t nfs ${HOST}:${PATH} ${DIR_PATH} -o vers=${PROTOCOL_VERSION},username=${USERNAME},password=${PASSWORD}"

	result := SubstitutePlaceholders(pattern, payload)

	assert.Contains(t, result, "server.example.com")
	assert.Contains(t, result, "/share/data")
	assert.Contains(t, result, "/mnt/base/run-1/path-1")
	assert.Contains(t, result, "3.0")
	assert.Contains(t, result, "admin")
	assert.Contains(t, result, "secret123")
	assert.NotContains(t, result, "${HOST}")
	assert.NotContains(t, result, "${PATH}")
	assert.NotContains(t, result, "${DIR_PATH}")
	assert.NotContains(t, result, "${PROTOCOL_VERSION}")
	assert.NotContains(t, result, "${USERNAME}")
	assert.NotContains(t, result, "${PASSWORD}")
}

func TestSubstitutePlaceholders_MountPathToken(t *testing.T) {
	payload := ProtocolPayload{
		Path:          "/data/share",
		MountBasePath: "/mnt",
		JobRunID:      "job-1",
		PathID:        "p-1",
	}

	pattern := "mount ${MOUNT_PATH} to ${DIR_PATH}"
	result := SubstitutePlaceholders(pattern, payload)

	assert.Contains(t, result, "/data/share")
	assert.Contains(t, result, "/mnt/job-1/p-1")
}

func TestSubstitutePlaceholders_EmptyPayload(t *testing.T) {
	payload := ProtocolPayload{}

	pattern := "connect ${HOST} ${USERNAME}"
	result := SubstitutePlaceholders(pattern, payload)

	assert.Equal(t, "connect  ", result)
}

func TestSanitizeCommand_MasksPassword(t *testing.T) {
	payload := ProtocolPayload{
		Username: "admin",
		Password: "my-secret-pass",
	}

	cmd := "smbclient -L //host -U admin%my-secret-pass"
	result := SanitizeCommand(cmd, payload)

	assert.NotContains(t, result, "my-secret-pass")
	assert.NotContains(t, result, "admin")
	assert.Contains(t, result, "******")
}

func TestSanitizeCommand_MasksUsername(t *testing.T) {
	payload := ProtocolPayload{
		Username: "testuser",
		Password: "",
	}

	cmd := "login testuser@server"
	result := SanitizeCommand(cmd, payload)

	assert.NotContains(t, result, "testuser")
	assert.Contains(t, result, "******")
}

func TestSanitizeCommand_EmptyCredentials(t *testing.T) {
	payload := ProtocolPayload{
		Username: "",
		Password: "",
	}

	cmd := "showmount -e 192.168.1.1"
	result := SanitizeCommand(cmd, payload)

	assert.Equal(t, cmd, result) // No changes when credentials are empty
}

func TestSanitizeCommand_WhitespaceOnlyCredentials(t *testing.T) {
	payload := ProtocolPayload{
		Username: "  ",
		Password: "  ",
	}

	cmd := "some command"
	result := SanitizeCommand(cmd, payload)

	// Whitespace-only credentials should not trigger replacement
	assert.Equal(t, cmd, result)
}

func TestGetMountDir(t *testing.T) {
	payload := ProtocolPayload{
		MountBasePath: "/mnt/datamigrate",
		JobRunID:      "run-123",
		PathID:        "path-456",
	}

	result := GetMountDir(payload)
	assert.Equal(t, "/mnt/datamigrate/run-123/path-456", result)
}

func TestGetMountDir_EmptyFields(t *testing.T) {
	payload := ProtocolPayload{
		MountBasePath: "",
		JobRunID:      "",
		PathID:        "",
	}

	result := GetMountDir(payload)
	// filepath.Join with all empty strings returns ""
	assert.Equal(t, "", result)
}

func TestRegisterProtocol_AndNewProtocol(t *testing.T) {
	// Clean up after test by saving current state
	factoryMu.Lock()
	originalMap := make(map[string]ProtocolFactory)
	for k, v := range factoryMap {
		originalMap[k] = v
	}
	factoryMu.Unlock()

	defer func() {
		factoryMu.Lock()
		factoryMap = originalMap
		factoryMu.Unlock()
	}()

	cfg := &config.Config{}
	log := logger.NewLogger("test", "debug")

	called := false
	RegisterProtocol("TEST", func(c *config.Config, l *logger.Logger) Protocol {
		called = true
		return nil
	})

	_ = NewProtocol("TEST", cfg, log)
	assert.True(t, called)
}

func TestNewProtocol_CaseInsensitive(t *testing.T) {
	factoryMu.Lock()
	originalMap := make(map[string]ProtocolFactory)
	for k, v := range factoryMap {
		originalMap[k] = v
	}
	factoryMu.Unlock()

	defer func() {
		factoryMu.Lock()
		factoryMap = originalMap
		factoryMu.Unlock()
	}()

	cfg := &config.Config{}
	log := logger.NewLogger("test", "debug")

	callCount := 0
	RegisterProtocol("myproto", func(c *config.Config, l *logger.Logger) Protocol {
		callCount++
		return nil
	})

	// Should work regardless of case
	_ = NewProtocol("myproto", cfg, log)
	assert.Equal(t, 1, callCount)

	_ = NewProtocol("MYPROTO", cfg, log)
	assert.Equal(t, 2, callCount)

	_ = NewProtocol("MyProto", cfg, log)
	assert.Equal(t, 3, callCount)
}

func TestNewProtocol_UnknownProtocol(t *testing.T) {
	cfg := &config.Config{}
	log := logger.NewLogger("test", "debug")

	result := NewProtocol("UNKNOWN_PROTOCOL_XYZ", cfg, log)
	assert.Nil(t, result)
}

func TestRegisterProtocol_UppercaseKey(t *testing.T) {
	factoryMu.Lock()
	originalMap := make(map[string]ProtocolFactory)
	for k, v := range factoryMap {
		originalMap[k] = v
	}
	factoryMu.Unlock()

	defer func() {
		factoryMu.Lock()
		factoryMap = originalMap
		factoryMu.Unlock()
	}()

	RegisterProtocol("lowercase", func(c *config.Config, l *logger.Logger) Protocol {
		return nil
	})

	// Verify it's stored as uppercase
	factoryMu.RLock()
	_, ok := factoryMap["LOWERCASE"]
	factoryMu.RUnlock()

	assert.True(t, ok)
}

func TestProtocolPayload_Fields(t *testing.T) {
	p := ProtocolPayload{
		Hostname:        "host",
		Username:        "user",
		Password:        "pass",
		Path:            "/path",
		MountBasePath:   "/mnt",
		JobRunID:        "run-1",
		PathID:          "p-1",
		ProtocolVersion: "3.0",
		DirPath:         "/dir",
	}

	assert.Equal(t, "host", p.Hostname)
	assert.Equal(t, "user", p.Username)
	assert.Equal(t, "pass", p.Password)
	assert.Equal(t, "/path", p.Path)
	assert.Equal(t, "/mnt", p.MountBasePath)
	assert.Equal(t, "run-1", p.JobRunID)
	assert.Equal(t, "p-1", p.PathID)
	assert.Equal(t, "3.0", p.ProtocolVersion)
	assert.Equal(t, "/dir", p.DirPath)
}

// Verify that ExecuteCommand does not crash with a simple echo command
func TestExecuteCommand_SimpleEcho(t *testing.T) {
	log := logger.NewLogger("test", "debug")
	payload := ProtocolPayload{}

	output, err := ExecuteCommand("echo hello", payload, 5, log)
	require.NoError(t, err)
	assert.Equal(t, "hello", output)
}

func TestExecuteCommand_FailingCommand(t *testing.T) {
	log := logger.NewLogger("test", "debug")
	payload := ProtocolPayload{}

	_, err := ExecuteCommand("false", payload, 5, log)
	assert.Error(t, err)
}

func TestExecuteCommand_DefaultTimeout(t *testing.T) {
	log := logger.NewLogger("test", "debug")
	payload := ProtocolPayload{}

	// Timeout <= 0 should use default of 5 seconds
	output, err := ExecuteCommand("echo ok", payload, 0, log)
	require.NoError(t, err)
	assert.Equal(t, "ok", output)
}
