package storageclient

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/netapp/ndm/services/go-worker/logger"
)

// newTestIsilonClient creates an IsilonClient pointed at the test server.
// The hostname is extracted from the test server URL (without the scheme).
func newTestIsilonClient(serverURL string, log *logger.Logger) *IsilonClient {
	// The IsilonClient builds URLs like https://<hostname>:8080/...
	// For testing we need to override the httpClient to point to our test server.
	client := &IsilonClient{
		hostname:   "test-host",
		username:   "admin",
		password:   "password",
		apiVersion: "7",
		logger:     log,
		httpClient: &http.Client{
			Transport: &testTransport{serverURL: serverURL},
		},
	}
	return client
}

// testTransport redirects all requests to the test server.
type testTransport struct {
	serverURL string
}

func (t *testTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Rewrite the URL to point to the test server.
	newURL := t.serverURL + req.URL.Path
	if req.URL.RawQuery != "" {
		newURL += "?" + req.URL.RawQuery
	}
	newReq, err := http.NewRequest(req.Method, newURL, req.Body)
	if err != nil {
		return nil, err
	}
	for k, v := range req.Header {
		newReq.Header[k] = v
	}
	return http.DefaultTransport.RoundTrip(newReq)
}

// ---------------------------------------------------------------------------
// ValidateConnection
// ---------------------------------------------------------------------------

func TestIsilonClient_ValidateConnection_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/platform/1/cluster/config", r.URL.Path)
		assert.Contains(t, r.Header.Get("Authorization"), "Basic")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"name":"test-cluster"}`))
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	err := client.ValidateConnection()
	assert.NoError(t, err)
}

func TestIsilonClient_ValidateConnection_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	err := client.ValidateConnection()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "401")
}

// ---------------------------------------------------------------------------
// GetNFSExportPaths
// ---------------------------------------------------------------------------

func TestIsilonClient_GetNFSExportPaths_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/platform/3/protocols/nfs/exports", r.URL.Path)

		resp := map[string]interface{}{
			"exports": []map[string]interface{}{
				{"paths": []string{"/ifs/data", "/ifs/home"}},
				{"paths": []string{"/ifs/backup"}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	paths, err := client.GetNFSExportPaths("fs-1")
	require.NoError(t, err)
	assert.Len(t, paths, 3)
	assert.Contains(t, paths, "/ifs/data")
	assert.Contains(t, paths, "/ifs/home")
	assert.Contains(t, paths, "/ifs/backup")
}

func TestIsilonClient_GetNFSExportPaths_EmptyExports(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"exports": []map[string]interface{}{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	paths, err := client.GetNFSExportPaths("fs-1")
	require.NoError(t, err)
	assert.Empty(t, paths)
}

func TestIsilonClient_GetNFSExportPaths_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal error"}`))
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	paths, err := client.GetNFSExportPaths("fs-1")
	assert.Error(t, err)
	assert.Nil(t, paths)
	assert.Contains(t, err.Error(), "500")
}

// ---------------------------------------------------------------------------
// GetSMBShares
// ---------------------------------------------------------------------------

func TestIsilonClient_GetSMBShares_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/platform/3/protocols/smb/shares", r.URL.Path)

		resp := map[string]interface{}{
			"shares": []map[string]interface{}{
				{"name": "share1", "path": "/ifs/data/share1"},
				{"name": "share2", "path": "/ifs/data/share2"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	shares, err := client.GetSMBShares("fs-1")
	require.NoError(t, err)
	assert.Len(t, shares, 2)
	assert.Equal(t, "share1", shares[0].Name)
	assert.Equal(t, "/ifs/data/share1", shares[0].Path)
	assert.Equal(t, "share2", shares[1].Name)
}

func TestIsilonClient_GetSMBShares_Empty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"shares": []map[string]interface{}{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	shares, err := client.GetSMBShares("fs-1")
	require.NoError(t, err)
	assert.Empty(t, shares)
}

func TestIsilonClient_GetSMBShares_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"forbidden"}`))
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	shares, err := client.GetSMBShares("fs-1")
	assert.Error(t, err)
	assert.Nil(t, shares)
}

// ---------------------------------------------------------------------------
// FetchCertificate
// ---------------------------------------------------------------------------

func TestIsilonClient_FetchCertificate_Success(t *testing.T) {
	// Create a TLS test server.
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := &IsilonClient{
		hostname:   "test-host",
		username:   "admin",
		password:   "pass",
		apiVersion: "7",
		logger:     log,
		httpClient: &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}

	// Extract host:port from the test server URL.
	addr := strings.TrimPrefix(server.URL, "https://")
	parts := strings.SplitN(addr, ":", 2)
	host := parts[0]

	var port int
	if len(parts) == 2 {
		for _, c := range parts[1] {
			port = port*10 + int(c-'0')
		}
	}

	certInfo, err := client.FetchCertificate(host, port)
	require.NoError(t, err)
	require.NotNil(t, certInfo)
	assert.NotEmpty(t, certInfo.Subject)
	assert.NotEmpty(t, certInfo.NotBefore)
	assert.NotEmpty(t, certInfo.NotAfter)
}

// ---------------------------------------------------------------------------
// FetchZones
// ---------------------------------------------------------------------------

func TestIsilonClient_FetchZones_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/pools") {
			resp := map[string]interface{}{
				"pools": []map[string]interface{}{
					{"name": "pool1", "ranges": []string{"10.0.0.1-10.0.0.10"}, "sc_dns_zone": "zone.example.com", "sc_subnet": "10.0.0.0"},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}

		resp := map[string]interface{}{
			"zones": []map[string]interface{}{
				{
					"id":   "1",
					"name": "groupnet0",
					"subnets": []map[string]interface{}{
						{"name": "subnet0"},
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)

	zones, err := client.FetchZones()
	require.NoError(t, err)
	require.Len(t, zones, 1)
	assert.Equal(t, "groupnet0", zones[0].Name)
	require.Len(t, zones[0].Subnets, 1)
	assert.Equal(t, "subnet0", zones[0].Subnets[0].Name)
	require.Len(t, zones[0].Subnets[0].Pools, 1)
	assert.Equal(t, "pool1", zones[0].Subnets[0].Pools[0].Name)
}

// ---------------------------------------------------------------------------
// doGet (basic auth verification)
// ---------------------------------------------------------------------------

func TestIsilonClient_DoGet_SetsBasicAuth(t *testing.T) {
	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	log := logger.NewLogger("test", "debug")
	client := newTestIsilonClient(server.URL, log)
	client.username = "testuser"
	client.password = "testpass"

	resp, err := client.doGet(server.URL + "/test")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Contains(t, receivedAuth, "Basic")
}
