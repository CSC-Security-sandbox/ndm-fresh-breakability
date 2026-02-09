package httpclient

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/auth"
	"github.com/netapp/ndm/services/go-worker/logger"
)

const (
	defaultTimeout = 30 * time.Second

	headerAuthorization  = "Authorization"
	headerAccept         = "Accept"
	headerContentType    = "Content-Type"
	headerClientPlatform = "x-client-platform"
	headerWorkerIP       = "x-worker-ip"

	mimeJSON = "application/json"
)

// Response holds the HTTP status code and raw body bytes returned by a
// request made through Client.
type Response struct {
	StatusCode int
	Body       []byte
}

// Client is an HTTP client that automatically injects Keycloak Bearer tokens
// and platform headers into every outgoing request. It is used by all
// internal services (Config, Job, Report) to communicate with the control
// plane.
type Client struct {
	auth       *auth.KeycloakAuth
	httpClient *http.Client
	logger     *logger.Logger
	workerIP   string
}

// Option configures optional Client behaviour.
type Option func(*Client)

// WithTimeout overrides the default 30-second HTTP timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		c.httpClient.Timeout = d
	}
}

// WithWorkerIP sets the x-worker-ip header value sent on every request.
func WithWorkerIP(ip string) Option {
	return func(c *Client) {
		c.workerIP = ip
	}
}

// NewClient creates a Client that uses the given KeycloakAuth for Bearer token
// injection. Optional configuration can be supplied via Option functions.
func NewClient(a *auth.KeycloakAuth, l *logger.Logger, opts ...Option) *Client {
	c := &Client{
		auth:   a,
		logger: l,
		httpClient: &http.Client{
			Timeout: defaultTimeout,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Get performs an HTTP GET to the given URL. Additional headers can be supplied
// via the headers map; they are merged with the standard set of injected
// headers.
func (c *Client) Get(url string, headers map[string]string) (*Response, error) {
	return c.do(http.MethodGet, url, nil, headers)
}

// Post performs an HTTP POST to the given URL with the provided JSON body.
func (c *Client) Post(url string, body []byte, headers map[string]string) (*Response, error) {
	return c.do(http.MethodPost, url, body, headers)
}

// Patch performs an HTTP PATCH to the given URL with the provided JSON body.
func (c *Client) Patch(url string, body []byte, headers map[string]string) (*Response, error) {
	return c.do(http.MethodPatch, url, body, headers)
}

// Put performs an HTTP PUT to the given URL with the provided JSON body.
func (c *Client) Put(url string, body []byte, headers map[string]string) (*Response, error) {
	return c.do(http.MethodPut, url, body, headers)
}

// do is the shared implementation for all HTTP methods. It builds the request,
// injects auth and platform headers, executes the call, and returns the
// response bytes.
func (c *Client) do(method, url string, body []byte, extraHeaders map[string]string) (*Response, error) {
	token, err := c.auth.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("httpclient: obtaining access token: %w", err)
	}

	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("httpclient: creating %s request to %s: %w", method, url, err)
	}

	// Standard headers injected on every request.
	req.Header.Set(headerAuthorization, "Bearer "+token)
	req.Header.Set(headerAccept, mimeJSON)
	req.Header.Set(headerClientPlatform, "linux")

	if body != nil {
		req.Header.Set(headerContentType, mimeJSON)
	}

	if c.workerIP != "" {
		req.Header.Set(headerWorkerIP, c.workerIP)
	}

	// Merge caller-supplied headers, allowing overrides of defaults.
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	c.logger.Debug("http request",
		zap.String("method", method),
		zap.String("url", logger.MaskIPs(url)),
	)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("httpclient: executing %s %s: %w", method, url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("httpclient: reading response body from %s %s: %w", method, url, err)
	}

	c.logger.Debug("http response",
		zap.String("method", method),
		zap.String("url", logger.MaskIPs(url)),
		zap.Int("status", resp.StatusCode),
		zap.Int("bodyLen", len(respBody)),
	)

	return &Response{
		StatusCode: resp.StatusCode,
		Body:       respBody,
	}, nil
}
