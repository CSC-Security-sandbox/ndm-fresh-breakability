package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/netapp/ndm/services/go-worker/config"
)

// tokenResponse represents the JSON body returned by the Keycloak token
// endpoint on a successful client-credentials grant.
type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

// tokenExpiryBuffer is subtracted from the token's actual expiry time so that
// a fresh token is fetched slightly before the old one expires. This avoids
// race conditions where a token is used just as it becomes invalid.
const tokenExpiryBuffer = 10 * time.Second

// KeycloakAuth handles OAuth2 client-credentials authentication against a
// Keycloak server. It caches the access token and automatically refreshes it
// when the cached token is about to expire. All methods are safe for
// concurrent use.
type KeycloakAuth struct {
	baseURL      string
	realm        string
	clientID     string
	clientSecret string

	cachedToken string
	expiresAt   time.Time
	mu          sync.Mutex

	httpClient *http.Client
}

// NewKeycloakAuth creates a new KeycloakAuth instance using values from the
// provided configuration. The workerSecret field from cfg is used for both the
// client_id and client_secret parameters in the token request, matching the
// behaviour of the TypeScript auth service.
func NewKeycloakAuth(cfg *config.Config) *KeycloakAuth {
	return &KeycloakAuth{
		baseURL:      cfg.KeycloakBaseURL,
		realm:        cfg.KeycloakRealm,
		clientID:     cfg.WorkerSecret,
		clientSecret: cfg.WorkerSecret,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// GetAccessToken returns a valid access token, using a cached value when
// available and not expired. If the cached token is missing or within the
// expiry buffer window, a new token is fetched from Keycloak. The method is
// safe for concurrent use; only one goroutine will refresh the token at a time.
func (k *KeycloakAuth) GetAccessToken() (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	if k.cachedToken != "" && time.Now().Before(k.expiresAt) {
		return k.cachedToken, nil
	}

	token, expiresIn, err := k.fetchToken()
	if err != nil {
		return "", fmt.Errorf("keycloak: failed to obtain access token: %w", err)
	}

	k.cachedToken = token
	k.expiresAt = time.Now().Add(time.Duration(expiresIn)*time.Second - tokenExpiryBuffer)

	return k.cachedToken, nil
}

// tokenEndpoint returns the full URL for the Keycloak OpenID Connect token
// endpoint for the configured realm.
func (k *KeycloakAuth) tokenEndpoint() string {
	return fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", k.baseURL, k.realm)
}

// fetchToken performs the HTTP POST to the Keycloak token endpoint using the
// client_credentials grant type. It returns the access token string and the
// number of seconds until it expires.
func (k *KeycloakAuth) fetchToken() (string, int, error) {
	data := url.Values{}
	data.Set("client_id", k.clientID)
	data.Set("client_secret", k.clientSecret)
	data.Set("grant_type", "client_credentials")

	req, err := http.NewRequest(http.MethodPost, k.tokenEndpoint(), strings.NewReader(data.Encode()))
	if err != nil {
		return "", 0, fmt.Errorf("creating token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("executing token request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, fmt.Errorf("reading token response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("token endpoint returned status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp tokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", 0, fmt.Errorf("decoding token response: %w", err)
	}

	if tokenResp.AccessToken == "" {
		return "", 0, fmt.Errorf("token endpoint returned empty access_token")
	}

	return tokenResp.AccessToken, tokenResp.ExpiresIn, nil
}
