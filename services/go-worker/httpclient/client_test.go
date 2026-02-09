package httpclient

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/auth"
	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// setupMockAuth creates a mock Keycloak server and returns a KeycloakAuth
// instance pointed at it.
func setupMockAuth(t *testing.T) (*auth.KeycloakAuth, func()) {
	t.Helper()
	keycloakServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"access_token": "mock-bearer-token",
			"expires_in":   300,
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))

	cfg := &config.Config{
		KeycloakBaseURL: keycloakServer.URL,
		KeycloakRealm:   "test-realm",
		WorkerID:        "test-worker-id",
		WorkerSecret:    "test-secret",
	}
	a := auth.NewKeycloakAuth(cfg)

	return a, keycloakServer.Close
}

func TestNewClient(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	c := NewClient(a, l)
	require.NotNil(t, c)
}

func TestClient_Get(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "Bearer mock-bearer-token", r.Header.Get("Authorization"))
		assert.Equal(t, "application/json", r.Header.Get("Accept"))
		assert.Equal(t, goosToNDMPlatform(), r.Header.Get("x-client-platform"))

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	resp, err := c.Get(apiServer.URL+"/test", nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, `{"status":"ok"}`, string(resp.Body))
}

func TestClient_Post(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "Bearer mock-bearer-token", r.Header.Get("Authorization"))
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"123"}`))
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	resp, err := c.Post(apiServer.URL+"/items", []byte(`{"name":"test"}`), nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
	assert.Equal(t, `{"id":"123"}`, string(resp.Body))
}

func TestClient_Patch(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPatch, r.Method)
		assert.Equal(t, "Bearer mock-bearer-token", r.Header.Get("Authorization"))

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"updated":true}`))
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	resp, err := c.Patch(apiServer.URL+"/items/123", []byte(`{"name":"updated"}`), nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestClient_Put(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPut, r.Method)
		assert.Equal(t, "Bearer mock-bearer-token", r.Header.Get("Authorization"))

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"replaced":true}`))
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	resp, err := c.Put(apiServer.URL+"/items/123", []byte(`{"name":"replaced"}`), nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestClient_AuthorizationHeaderInjection(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	var capturedAuthHeader string
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuthHeader = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	_, err := c.Get(apiServer.URL, nil)
	require.NoError(t, err)

	assert.Equal(t, "Bearer mock-bearer-token", capturedAuthHeader)
}

func TestClient_ClientPlatformHeader(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	var capturedPlatform string
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPlatform = r.Header.Get("x-client-platform")
		w.WriteHeader(http.StatusOK)
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	_, err := c.Get(apiServer.URL, nil)
	require.NoError(t, err)

	assert.Equal(t, goosToNDMPlatform(), capturedPlatform)
}

func TestClient_WorkerIPHeader(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	var capturedWorkerIP string
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedWorkerIP = r.Header.Get("x-worker-ip")
		w.WriteHeader(http.StatusOK)
	}))
	defer apiServer.Close()

	c := NewClient(a, l, WithWorkerIP("10.0.0.5"))
	_, err := c.Get(apiServer.URL, nil)
	require.NoError(t, err)

	assert.Equal(t, "10.0.0.5", capturedWorkerIP)
}

func TestClient_ExtraHeaders(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	var capturedCustomHeader string
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedCustomHeader = r.Header.Get("X-Custom-Header")
		w.WriteHeader(http.StatusOK)
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	headers := map[string]string{"X-Custom-Header": "custom-value"}
	_, err := c.Get(apiServer.URL, headers)
	require.NoError(t, err)

	assert.Equal(t, "custom-value", capturedCustomHeader)
}

func TestClient_WithTimeout(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	c := NewClient(a, l, WithTimeout(5*time.Second))
	assert.Equal(t, 5*time.Second, c.httpClient.Timeout)
}

func TestClient_GetWithNoBody(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GET should NOT have Content-Type header set (no body)
		assert.Empty(t, r.Header.Get("Content-Type"))
		w.WriteHeader(http.StatusOK)
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	_, err := c.Get(apiServer.URL, nil)
	require.NoError(t, err)
}

func TestClient_PostSetsContentType(t *testing.T) {
	a, cleanup := setupMockAuth(t)
	defer cleanup()
	l := logger.NewLogger("test", "debug")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		w.WriteHeader(http.StatusOK)
	}))
	defer apiServer.Close()

	c := NewClient(a, l)
	_, err := c.Post(apiServer.URL, []byte(`{}`), nil)
	require.NoError(t, err)
}
