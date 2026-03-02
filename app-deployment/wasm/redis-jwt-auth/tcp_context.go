package main

import (
	"bytes"
	"fmt"
	"net/url"

	"github.com/tetratelabs/proxy-wasm-go-sdk/proxywasm"
	"github.com/tetratelabs/proxy-wasm-go-sdk/proxywasm/types"
)

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// tcpContext handles each TCP connection to Redis
type tcpContext struct {
	types.DefaultTcpContext
	contextID     uint32
	pluginContext *pluginContext
	buffer        []byte
	validated     bool
}

// OnDownstreamData is called when data is received from the client
func (ctx *tcpContext) OnDownstreamData(dataSize int, endOfStream bool) types.Action {
	// If already validated, pass all traffic through
	if ctx.validated {
		return types.ActionContinue
	}

	// Read incoming data
	data, err := proxywasm.GetDownstreamData(0, dataSize)
	if err != nil {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to get downstream data: %v", ctx.contextID, err)
		return types.ActionPause
	}

	// Append to buffer
	ctx.buffer = append(ctx.buffer, data...)

	proxywasm.LogDebugf("[Redis JWT Auth] Connection %d: Buffered %d bytes, total buffer size: %d", ctx.contextID, dataSize, len(ctx.buffer))

	// Try to extract JWT from AUTH command using proper RESP parser
	isJWT, _, value, found := extractJWTOrPasswordFromRESP(ctx.buffer)

	proxywasm.LogDebugf("[Redis JWT Auth] Connection %d: RESP parse result - found=%v, isJWT=%v, value_len=%d", ctx.contextID, found, isJWT, len(value))

	if !found {
		if len(ctx.buffer) > 10000 {
			// Buffer exceeded reasonable size without AUTH - reject connection
			proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: No AUTH command in 10KB, rejecting connection", ctx.contextID)
			ctx.sendRedisError("ERR authentication required")
			return types.ActionPause
		}
		// Need more data
		proxywasm.LogDebugf("[Redis JWT Auth] Connection %d: AUTH command not found yet, continuing to buffer",
			ctx.contextID)
		return types.ActionPause
	}

	// AUTH command found - check if it's JWT (STRICT mode - JWT required!)
	if !isJWT {
		// STRICT mode: reject non-JWT auth
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Non-JWT AUTH rejected in STRICT mode - JWT required", ctx.contextID)
		ctx.sendRedisError("ERR JWT authentication required")
		return types.ActionPause
	}

	// JWT authentication - validate with Keycloak
	proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: JWT AUTH command found, JWT length: %d, starting validation",
		ctx.contextID, len(value))
	
	// Log full JWT for debugging
	proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: FULL JWT TOKEN: %s",
		ctx.contextID, value)

	// Validate JWT with Keycloak
	return ctx.validateJWT(value)
}

// validateJWT makes an async HTTP call to Keycloak for token introspection
func (ctx *tcpContext) validateJWT(jwt string) types.Action {
	// Prepare Keycloak introspection request body
	body := fmt.Sprintf("token=%s&client_id=%s&client_secret=%s",
		url.QueryEscape(jwt),
		url.QueryEscape(ctx.pluginContext.config.ClientID),
		url.QueryEscape(ctx.pluginContext.config.ClientSecret))

	// Prepare HTTP headers
	headers := [][2]string{
		{":method", "POST"},
		{":path", "/keycloak/realms/datamigrator/protocol/openid-connect/token/introspect"},
		{":authority", "keycloak.keycloak.svc.cluster.local"},
		{"content-type", "application/x-www-form-urlencoded"},
	}

	proxywasm.LogInfof("[Redis JWT Auth] Connection %d: Calling Keycloak introspection endpoint",
		ctx.contextID)

	// Make async HTTP call to Keycloak cluster with callback
	_, err := proxywasm.DispatchHttpCall(
		"keycloak_cluster", // Cluster name defined in EnvoyFilter
		headers,
		[]byte(body),
		nil,  // No trailers
		5000, // 5 second timeout
		func(numHeaders, bodySize, numTrailers int) {
			ctx.OnHttpCallResponse(numHeaders, bodySize, numTrailers)
		},
	)

	if err != nil {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to dispatch HTTP call: %v", ctx.contextID, err)
		ctx.sendRedisError("ERR authentication service unavailable")
		return types.ActionPause
	}

	// Pause processing until we get the callback response
	return types.ActionPause
}

// OnHttpCallResponse is called when Keycloak responds to the introspection request
func (ctx *tcpContext) OnHttpCallResponse(numHeaders, bodySize, numTrailers int) {
	// Get HTTP status code
	headers, err := proxywasm.GetHttpCallResponseHeaders()
	if err != nil {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to get response headers: %v", ctx.contextID, err)
		ctx.sendRedisError("ERR authentication service error")
		return
	}

	var status string
	for _, h := range headers {
		if h[0] == ":status" {
			status = h[1]
			break
		}
	}

	proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Keycloak response status: %s", ctx.contextID, status)

	// Check for 200 OK
	if status != "200" {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Keycloak returned non-200 status: %s", ctx.contextID, status)
		ctx.sendRedisError("ERR authentication failed")
		return
	}

	// Get response body
	body, err := proxywasm.GetHttpCallResponseBody(0, bodySize)
	if err != nil {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to get response body: %v", ctx.contextID, err)
		ctx.sendRedisError("ERR authentication service error")
		return
	}

	// DEBUG: Log the response body to see what Keycloak actually returned
	proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Keycloak response body (first 200 chars): %s", ctx.contextID, string(body[:min(200, len(body))]))

	// Check if token is active (simple pattern matching for "active":true)
	if bytes.Contains(body, []byte(`"active":true`)) || bytes.Contains(body, []byte(`"active": true`)) {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: JWT validation successful - allowing connection", ctx.contextID)
		ctx.validated = true

		// Clear buffer - Redis doesn't need password
		ctx.buffer = nil

		// Resume the TCP stream - all traffic passes through now
		if err := proxywasm.ContinueTcpStream(); err != nil {
			proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to continue TCP stream: %v", ctx.contextID, err)
			ctx.sendRedisError("ERR authentication service error")
			return
		}

		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Connection authorized, stream resumed", ctx.contextID)
	} else {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: JWT validation failed - token inactive or invalid", ctx.contextID)
		ctx.sendRedisError("ERR invalid JWT token")
	}
}

// sendRedisError sends a Redis error response and closes the connection
func (ctx *tcpContext) sendRedisError(message string) {
	errorMsg := fmt.Sprintf("-%s\r\n", message)
	if err := proxywasm.AppendDownstreamData([]byte(errorMsg)); err != nil {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to send error: %v", ctx.contextID, err)
	}
	if err := proxywasm.CloseDownstream(); err != nil {
		proxywasm.LogCriticalf("[Redis JWT Auth] Connection %d: Failed to close connection: %v", ctx.contextID, err)
	}
}
