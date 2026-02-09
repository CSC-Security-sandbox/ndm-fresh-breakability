package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/config"
)

func newMockKeycloakServer(t *testing.T, token string, expiresIn int, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))

		err := r.ParseForm()
		require.NoError(t, err)
		assert.Equal(t, "client_credentials", r.FormValue("grant_type"))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)

		resp := tokenResponse{
			AccessToken: token,
			ExpiresIn:   expiresIn,
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

func newKeycloakAuthWithServer(serverURL string) *KeycloakAuth {
	cfg := &config.Config{
		KeycloakBaseURL: serverURL,
		KeycloakRealm:   "test-realm",
		WorkerID:        "test-worker-id",
		WorkerSecret:    "test-secret",
	}
	return NewKeycloakAuth(cfg)
}

func TestNewKeycloakAuth(t *testing.T) {
	cfg := &config.Config{
		KeycloakBaseURL: "https://keycloak.example.com",
		KeycloakRealm:   "my-realm",
		WorkerID:        "my-worker-id",
		WorkerSecret:    "my-secret",
	}
	auth := NewKeycloakAuth(cfg)

	assert.Equal(t, "https://keycloak.example.com", auth.baseURL)
	assert.Equal(t, "my-realm", auth.realm)
	assert.Equal(t, "my-worker-id", auth.clientID)
	assert.Equal(t, "my-secret", auth.clientSecret)
	assert.NotNil(t, auth.httpClient)
}

func TestGetAccessToken_Success(t *testing.T) {
	server := newMockKeycloakServer(t, "test-token-abc", 300, http.StatusOK)
	defer server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	token, err := auth.GetAccessToken()
	require.NoError(t, err)
	assert.Equal(t, "test-token-abc", token)
}

func TestGetAccessToken_CachesToken(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		resp := tokenResponse{
			AccessToken: "cached-token",
			ExpiresIn:   300,
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	// First call fetches from server
	token1, err := auth.GetAccessToken()
	require.NoError(t, err)
	assert.Equal(t, "cached-token", token1)
	assert.Equal(t, 1, callCount)

	// Second call uses cache
	token2, err := auth.GetAccessToken()
	require.NoError(t, err)
	assert.Equal(t, "cached-token", token2)
	assert.Equal(t, 1, callCount) // Still only one call
}

func TestGetAccessToken_RefreshesExpiredToken(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		resp := tokenResponse{
			AccessToken: "token-" + time.Now().Format("150405.000"),
			ExpiresIn:   1, // 1 second expiry, with 10s buffer means already expired
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	// First call fetches from server
	_, err := auth.GetAccessToken()
	require.NoError(t, err)
	assert.Equal(t, 1, callCount)

	// Token has expiresIn=1, but the buffer is 10 seconds, so
	// expiresAt = now + 1s - 10s = now - 9s, which is already in the past.
	// Second call should fetch a new token.
	_, err = auth.GetAccessToken()
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
}

func TestGetAccessToken_ErrorOnBadStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	token, err := auth.GetAccessToken()
	assert.Error(t, err)
	assert.Empty(t, token)
	assert.Contains(t, err.Error(), "keycloak: failed to obtain access token")
}

func TestGetAccessToken_ErrorOnEmptyToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := tokenResponse{
			AccessToken: "",
			ExpiresIn:   300,
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	token, err := auth.GetAccessToken()
	assert.Error(t, err)
	assert.Empty(t, token)
	assert.Contains(t, err.Error(), "empty access_token")
}

func TestGetAccessToken_ErrorOnInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not json`))
	}))
	defer server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	token, err := auth.GetAccessToken()
	assert.Error(t, err)
	assert.Empty(t, token)
	assert.Contains(t, err.Error(), "decoding token response")
}

func TestGetAccessToken_ErrorOnConnectionFailure(t *testing.T) {
	// Use a server that's immediately closed
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.Close()

	auth := newKeycloakAuthWithServer(server.URL)

	token, err := auth.GetAccessToken()
	assert.Error(t, err)
	assert.Empty(t, token)
}

func TestTokenEndpoint(t *testing.T) {
	auth := &KeycloakAuth{
		baseURL: "https://keycloak.example.com",
		realm:   "my-realm",
	}

	endpoint := auth.tokenEndpoint()
	assert.Equal(t, "https://keycloak.example.com/realms/my-realm/protocol/openid-connect/token", endpoint)
}

func TestFetchToken_SendsCorrectFormData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := r.ParseForm()
		require.NoError(t, err)

		assert.Equal(t, "test-client-id", r.FormValue("client_id"))
		assert.Equal(t, "test-client-secret", r.FormValue("client_secret"))
		assert.Equal(t, "client_credentials", r.FormValue("grant_type"))

		w.Header().Set("Content-Type", "application/json")
		resp := tokenResponse{
			AccessToken: "valid-token",
			ExpiresIn:   600,
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	auth := &KeycloakAuth{
		baseURL:      server.URL,
		realm:        "test",
		clientID:     "test-client-id",
		clientSecret: "test-client-secret",
		httpClient:   http.DefaultClient,
	}

	token, expiresIn, err := auth.fetchToken()
	require.NoError(t, err)
	assert.Equal(t, "valid-token", token)
	assert.Equal(t, 600, expiresIn)
}
