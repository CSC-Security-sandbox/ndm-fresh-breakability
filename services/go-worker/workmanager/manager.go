package workmanager

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/activities"
	"github.com/netapp/ndm/services/go-worker/auth"
	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/httpclient"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// WorkerType identifies the class of Temporal worker that should be launched
// for a given meta-configuration entry.
type WorkerType string

const (
	// ParentWorkflow workers run the top-level orchestration workflows
	// (Discovery, Migration, CutOver).
	ParentWorkflow WorkerType = "PARENT_WORKFLOW"

	// WorkerSpecific workers run utility workflows that are scoped to a single
	// worker instance (setup, cleanup, validation, pre-check, etc.).
	WorkerSpecific WorkerType = "WORKER_SPECIFIC"

	// JobSpecific workers run the child workflows that perform the actual file
	// scanning and syncing for a particular job run.
	JobSpecific WorkerType = "JOB_SPECIFIC"
)

// Workflow type names as returned by the config service. They match the
// TypeScript WorkFlowType enum in worker-options.types.ts.
const (
	configNameParentWorkflow   = "PARENT_WORKFLOW"
	configNameWorkerSpecific   = "WORKER_SPECIFIC_WORKFLOW"
	configNameJobSpecific      = "JOB_SPECIFIC_WORKFLOW"
)

// Static task queue base names matching the TypeScript worker-options factory.
const (
	parentTaskQueue  = "ParentWorkflow-TaskQueue"
	workerTaskQueue  = "TaskQueue"
)

// pollInterval is how frequently the WorkManager asks the Config Service for
// the latest set of worker configurations.
const pollInterval = 10 * time.Second

// ---------------------------------------------------------------------------
// Wire types — JSON shapes produced by the Config Service
// ---------------------------------------------------------------------------

// WorkerConfiguration mirrors the TypeScript WorkerConfiguration class. The
// config service returns an array of these inside the metaConfig field.
type WorkerConfiguration struct {
	WorkerID         string `json:"workerId"`
	ConfigName       string `json:"configName"`
	TaskQueueID      string `json:"taskQueueId"`
	DynamicTaskQueue bool   `json:"dynamicTaskQueue"`
}

// registrationRequest is the JSON body sent to the Config Service's
// POST /api/v1/work-manager/config endpoint. It mirrors the TypeScript worker
// which sends { envVariables: process.env, isRebootCall: true }.
type registrationRequest struct {
	EnvVariables map[string]string `json:"envVariables"`
	IsRebootCall bool              `json:"isRebootCall"`
}

// apiResponse models the standard JSON envelope produced by the Config
// Service's ResponseInterceptor. The structure is:
//
//	{ "trackId": "...", "message": "...", "data": { "items": { ... } } }
type apiResponse struct {
	TrackID string `json:"trackId"`
	Message string `json:"message"`
	Data    struct {
		Items json.RawMessage `json:"items"`
	} `json:"data"`
}

// configPayload is the inner object inside data.items for both the POST
// (registration) and GET (poll) responses.
type configPayload struct {
	MetaConfig   []WorkerConfiguration `json:"metaConfig"`
	EnvVariables map[string]string     `json:"envVariables"`
}

// ---------------------------------------------------------------------------
// WorkManager
// ---------------------------------------------------------------------------

// WorkManager coordinates the lifecycle of Temporal workers on behalf of the
// go-worker process. It registers with the Config Service, creates a Temporal
// client, and then polls for configuration changes -- starting and stopping
// Temporal workers as directed by the control plane.
type WorkManager struct {
	cfg            *config.Config
	auth           *auth.KeycloakAuth
	httpClient     *httpclient.Client
	temporalClient client.Client
	activities     *activities.Activities
	logger         *logger.Logger

	activeWorkers map[string]worker.Worker
	mu            sync.Mutex

	cancel context.CancelFunc
	done   chan struct{}
}

// NewWorkManager creates a WorkManager but does not start it. Call Start to
// register with the Config Service and begin the polling loop.
func NewWorkManager(
	cfg *config.Config,
	a *auth.KeycloakAuth,
	httpClient *httpclient.Client,
	acts *activities.Activities,
	log *logger.Logger,
) *WorkManager {
	return &WorkManager{
		cfg:           cfg,
		auth:          a,
		httpClient:    httpClient,
		activities:    acts,
		logger:        log,
		activeWorkers: make(map[string]worker.Worker),
		done:          make(chan struct{}),
	}
}

// Start registers this worker with the Config Service, creates a Temporal
// client using the returned (or environment-based) configuration, and starts
// a background goroutine that polls for worker configuration changes every
// pollInterval.
func (wm *WorkManager) Start(ctx context.Context) error {
	// Step 1: Register with Config Service.
	payload, err := wm.register(ctx)
	if err != nil {
		return fmt.Errorf("workmanager: registration failed: %w", err)
	}

	// Step 2: Apply any overrides from the registration response.
	wm.applyEnvOverrides(payload)

	// Step 3: Create the Temporal client.
	tc, err := wm.createTemporalClient()
	if err != nil {
		return fmt.Errorf("workmanager: creating temporal client: %w", err)
	}
	wm.temporalClient = tc

	// Step 4: Reconcile initial metaConfig returned from registration.
	wm.reconcileWorkers(payload.MetaConfig)

	// Step 5: Start the polling loop in a background goroutine.
	pollCtx, cancel := context.WithCancel(ctx)
	wm.cancel = cancel

	go wm.pollLoop(pollCtx)

	wm.logger.Info("WorkManager started",
		zap.String("workerId", wm.cfg.WorkerID),
		zap.String("temporalAddress", wm.cfg.TemporalAddress),
	)

	return nil
}

// Stop gracefully shuts down the polling loop, stops all active Temporal
// workers, and closes the Temporal client connection.
func (wm *WorkManager) Stop() {
	wm.logger.Info("WorkManager stopping")

	// Cancel the polling goroutine.
	if wm.cancel != nil {
		wm.cancel()
		<-wm.done
	}

	// Stop every active Temporal worker.
	wm.mu.Lock()
	for id, w := range wm.activeWorkers {
		wm.logger.Info("Stopping worker", zap.String("id", id))
		w.Stop()
		delete(wm.activeWorkers, id)
	}
	wm.mu.Unlock()

	// Close the Temporal client.
	if wm.temporalClient != nil {
		wm.temporalClient.Close()
	}

	wm.logger.Info("WorkManager stopped")
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// collectEnvVars builds a map of the current process environment. This is the
// Go equivalent of sending process.env in the TypeScript worker.
func collectEnvVars() map[string]string {
	envs := os.Environ()
	m := make(map[string]string, len(envs))
	for _, e := range envs {
		if k, v, ok := strings.Cut(e, "="); ok {
			m[k] = v
		}
	}
	return m
}

// register sends a POST to the Config Service to announce this worker. The
// request body mirrors the TypeScript worker:
//
//	{ envVariables: process.env, isRebootCall: true }
//
// The server uses the JWT token (Authorization header) to extract worker_id
// and project_id. The x-client-platform and x-worker-ip headers are injected
// by the httpclient automatically.
func (wm *WorkManager) register(ctx context.Context) (*configPayload, error) {
	body := registrationRequest{
		EnvVariables: collectEnvVars(),
		IsRebootCall: true,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshalling registration body: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/work-manager/config",
		strings.TrimRight(wm.cfg.ConfigServiceURL, "/"))

	resp, err := wm.httpClient.Post(url, payload, nil)
	if err != nil {
		return nil, fmt.Errorf("POST %s: %w", url, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("POST %s returned status %d: %s", url, resp.StatusCode, string(resp.Body))
	}

	cp, err := parseConfigResponse(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("parsing registration response: %w", err)
	}

	wm.logger.Info("Registered with Config Service",
		zap.String("workerId", wm.cfg.WorkerID),
		zap.String("platform", runtime.GOOS),
		zap.Int("metaConfigCount", len(cp.MetaConfig)),
	)

	return cp, nil
}

// applyEnvOverrides examines the envVariables returned by the config service
// and applies Temporal / Redis overrides when present. The most important one
// is TEMPORAL_TLS_CA_CERT which the config service may inject from a
// Kubernetes secret.
func (wm *WorkManager) applyEnvOverrides(cp *configPayload) {
	if cp == nil || len(cp.EnvVariables) == 0 {
		return
	}
	ev := cp.EnvVariables

	if v := ev["TEMPORAL_ADDRESS"]; v != "" {
		wm.cfg.TemporalAddress = v
	}
	if v := ev["TEMPORAL_TLS_CA_CERT"]; v != "" {
		wm.cfg.TemporalTLSCACert = v
		wm.cfg.TemporalTLSEnabled = true
		wm.logger.Info("Applied TEMPORAL_TLS_CA_CERT from config service")
	}
	if v := ev["TEMPORAL_TLS_SERVER_NAME"]; v != "" {
		wm.cfg.TemporalTLSServerName = v
	}
	if v := ev["REDIS_HOST"]; v != "" {
		wm.cfg.RedisHost = v
	}
	if v := ev["REDIS_PORT"]; v != "" {
		wm.cfg.RedisPort = v
	}
	if v := ev["REDIS_USERNAME"]; v != "" {
		wm.cfg.RedisUsername = v
	}
	if v := ev["REDIS_PASSWORD"]; v != "" {
		wm.cfg.RedisPassword = v
	}
}

// parseConfigResponse decodes the standard ResponseInterceptor wrapper and
// extracts the configPayload from data.items.
func parseConfigResponse(raw []byte) (*configPayload, error) {
	var envelope apiResponse
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decoding response envelope: %w", err)
	}

	var cp configPayload
	if err := json.Unmarshal(envelope.Data.Items, &cp); err != nil {
		return nil, fmt.Errorf("decoding data.items: %w", err)
	}

	return &cp, nil
}

// createTemporalClient builds a Temporal SDK client using the current
// Config values for address, TLS, and JWT. It mirrors the TypeScript
// buildTemporalConfig / createTemporalConnections utilities.
//
// The TypeScript worker's buildTemporalConfig function:
//   - Applies TLS only when BOTH tlsEnabled=true AND tlsCaCert is present.
//   - Applies JWT independently: fetches the token ONCE at connection time
//     and passes it as a static metadata header.
//   - When tlsEnabled=true but no CA cert → silently skips TLS (plain gRPC).
func (wm *WorkManager) createTemporalClient() (client.Client, error) {
	// Normalize "localhost" to "127.0.0.1" to avoid IPv6 resolution issues.
	// On macOS, "localhost" often resolves to ::1 first, but Docker typically
	// only binds to IPv4. The Go gRPC library (grpc.NewClient with dns
	// resolver) does not handle IPv4/IPv6 fallback gracefully, causing
	// connection timeouts. The TypeScript gRPC library handles this
	// transparently which is why the TS worker has no issue.
	address := normalizeLocalhost(wm.cfg.TemporalAddress)

	opts := client.Options{
		HostPort:  address,
		Namespace: "default",
		Logger:    newTemporalLogger(wm.logger),
	}

	wm.logger.Info("Creating Temporal client",
		zap.String("address", address),
		zap.Bool("tlsEnabled", wm.cfg.TemporalTLSEnabled),
		zap.Bool("hasCACert", wm.cfg.TemporalTLSCACert != ""),
		zap.String("tlsServerName", wm.cfg.TemporalTLSServerName),
		zap.Bool("jwtEnabled", wm.cfg.TemporalJWTEnabled),
	)

	// Configure TLS if enabled AND a CA certificate is available.
	// The TypeScript worker does: Buffer.from(tlsCaCert, 'base64')
	// so the cert returned by the config service is base64-encoded.
	// When no CA cert is present (e.g. local dev), TLS is silently skipped
	// just like the TypeScript worker does.
	if wm.cfg.TemporalTLSEnabled && wm.cfg.TemporalTLSCACert != "" {
		// Try base64 decode first (config service returns base64).
		certPEM, err := base64.StdEncoding.DecodeString(wm.cfg.TemporalTLSCACert)
		if err != nil {
			// Fallback: treat as raw PEM if base64 decode fails.
			certPEM = []byte(wm.cfg.TemporalTLSCACert)
		}

		wm.logger.Info("TLS certificate loaded",
			zap.Int("certBytes", len(certPEM)),
		)

		certPool := x509.NewCertPool()
		if !certPool.AppendCertsFromPEM(certPEM) {
			return nil, fmt.Errorf("failed to parse Temporal TLS CA certificate")
		}

		// Strip surrounding quotes from server name if present (godotenv
		// preserves single-quoted values literally).
		serverName := strings.Trim(wm.cfg.TemporalTLSServerName, "'\"")

		tlsCfg := &tls.Config{
			RootCAs:    certPool,
			MinVersion: tls.VersionTLS12,
		}
		if serverName != "" {
			tlsCfg.ServerName = serverName
		}

		opts.ConnectionOptions = client.ConnectionOptions{
			TLS: tlsCfg,
		}
	} else if wm.cfg.TemporalTLSEnabled {
		wm.logger.Warn("TLS enabled but no CA certificate available — connecting without TLS (local dev mode)")
	}

	// Configure JWT authentication if enabled. The TypeScript worker fetches
	// the token ONCE at connection time and passes it as static metadata:
	//   temporalConfig.metadata = { authorization: `Bearer ${token}` }
	// We mirror this exactly — fetch once, set as HeadersProvider.
	// If the token fetch fails (e.g. Keycloak not reachable in local dev),
	// we log a warning and proceed without JWT rather than blocking the
	// entire connection.
	if wm.cfg.TemporalJWTEnabled {
		wm.logger.Info("JWT authentication enabled for Temporal connection")

		token, err := wm.auth.GetAccessToken()
		if err != nil {
			wm.logger.Warn("Failed to obtain JWT for Temporal — connecting without JWT auth",
				zap.Error(err),
			)
		} else {
			// Use Temporal SDK's HeadersProvider to inject static metadata,
			// matching the TS worker's connection-level metadata approach.
			opts.HeadersProvider = &staticHeadersProvider{
				headers: map[string]string{
					"authorization": "Bearer " + token,
				},
			}
			wm.logger.Info("JWT token obtained for Temporal connection")
		}
	}

	return client.Dial(opts)
}

// normalizeLocalhost replaces "localhost" in the host portion of an address
// with "127.0.0.1". This avoids IPv6 resolution issues on macOS where
// "localhost" resolves to ::1 first but Docker only listens on IPv4.
func normalizeLocalhost(addr string) string {
	host, port, found := strings.Cut(addr, ":")
	if found && strings.EqualFold(host, "localhost") {
		return "127.0.0.1:" + port
	}
	if strings.EqualFold(addr, "localhost") {
		return "127.0.0.1"
	}
	return addr
}

// staticHeadersProvider implements client.HeadersProvider by returning a fixed
// set of headers on every call. This mirrors the TypeScript worker which sets
// metadata: { authorization: 'Bearer <token>' } once at connection time.
type staticHeadersProvider struct {
	headers map[string]string
}

func (s *staticHeadersProvider) GetHeaders(_ context.Context) (map[string]string, error) {
	return s.headers, nil
}

// pollLoop runs the configuration-fetch ticker until the context is cancelled.
func (wm *WorkManager) pollLoop(ctx context.Context) {
	defer close(wm.done)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := wm.handleConfigurations(ctx); err != nil {
				wm.logger.Warn("workmanager: configuration poll failed", zap.Error(err))
			}
		}
	}
}

// handleConfigurations fetches the current list of WorkerConfiguration entries
// from the Config Service and reconciles them with the set of running workers.
// The GET endpoint is /api/v1/work-manager/config (no workerId in path); the
// server extracts the worker identity from the JWT token.
func (wm *WorkManager) handleConfigurations(ctx context.Context) error {
	url := fmt.Sprintf("%s/api/v1/work-manager/config",
		strings.TrimRight(wm.cfg.ConfigServiceURL, "/"))

	resp, err := wm.httpClient.Get(url, nil)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned status %d: %s", url, resp.StatusCode, string(resp.Body))
	}

	cp, err := parseConfigResponse(resp.Body)
	if err != nil {
		return fmt.Errorf("parsing poll response: %w", err)
	}

	wm.reconcileWorkers(cp.MetaConfig)
	return nil
}

// getWorkerIdentity builds a unique key for a WorkerConfiguration. This
// mirrors the TypeScript utility:
//
//	`${config.workerId}/${config.configName}${config.dynamicTaskQueue ? '-' + config.taskQueueId : ''}`
func getWorkerIdentity(wc WorkerConfiguration) string {
	id := wc.WorkerID + "/" + wc.ConfigName
	if wc.DynamicTaskQueue {
		id += "-" + wc.TaskQueueID
	}
	return id
}

// resolveTaskQueue converts a WorkerConfiguration into the actual Temporal
// task queue name, replicating the TypeScript WorkFlowOptions constructor:
//
//	static  → baseTaskQueue
//	dynamic → "${taskQueueId}-${baseTaskQueue}"
func resolveTaskQueue(wc WorkerConfiguration) string {
	switch wc.ConfigName {
	case configNameParentWorkflow:
		return parentTaskQueue // "ParentWorkflow-TaskQueue"
	case configNameWorkerSpecific:
		if wc.DynamicTaskQueue && wc.TaskQueueID != "" {
			return wc.TaskQueueID + "-" + workerTaskQueue // e.g. "${workerId}-TaskQueue"
		}
		return workerTaskQueue
	case configNameJobSpecific:
		if wc.DynamicTaskQueue && wc.TaskQueueID != "" {
			return wc.TaskQueueID + "-" + workerTaskQueue // e.g. "${jobRunId}-TaskQueue"
		}
		return workerTaskQueue
	default:
		return workerTaskQueue
	}
}

// resolveWorkerType maps the config service's configName to the Go WorkerType.
func resolveWorkerType(configName string) WorkerType {
	switch configName {
	case configNameParentWorkflow:
		return ParentWorkflow
	case configNameWorkerSpecific:
		return WorkerSpecific
	case configNameJobSpecific:
		return JobSpecific
	default:
		return WorkerSpecific
	}
}

// reconcileWorkers compares the desired set of WorkerConfigurations with the
// currently running Temporal workers, starting new ones and stopping stale
// ones.
func (wm *WorkManager) reconcileWorkers(configs []WorkerConfiguration) {
	desired := make(map[string]WorkerConfiguration, len(configs))
	for _, wc := range configs {
		desired[getWorkerIdentity(wc)] = wc
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	// Start workers that are desired but not yet running.
	for id, wc := range desired {
		if _, running := wm.activeWorkers[id]; !running {
			taskQueue := resolveTaskQueue(wc)
			wtype := resolveWorkerType(wc.ConfigName)
			if err := wm.startWorker(id, taskQueue, wtype); err != nil {
				wm.logger.Error("workmanager: failed to start worker",
					zap.String("id", id),
					zap.String("taskQueue", taskQueue),
					zap.Error(err),
				)
			}
		}
	}

	// Stop workers that are running but no longer desired.
	for id, w := range wm.activeWorkers {
		if _, ok := desired[id]; !ok {
			wm.logger.Info("Stopping stale worker", zap.String("id", id))
			w.Stop()
			delete(wm.activeWorkers, id)
		}
	}
}

// startWorker creates a new Temporal worker for the given task queue and
// worker type, registers the appropriate workflows and activities, starts the
// worker, and records it in the active set. Caller must hold wm.mu.
func (wm *WorkManager) startWorker(id, taskQueue string, wtype WorkerType) error {
	opts := worker.Options{
		MaxConcurrentActivityExecutionSize: wm.cfg.MaxActivityConcurrency,
	}

	w := worker.New(wm.temporalClient, taskQueue, opts)

	registerWorkflows(w, wtype)
	registerActivities(w, wm.activities, wtype)

	if err := w.Start(); err != nil {
		return fmt.Errorf("starting temporal worker on queue %s: %w", taskQueue, err)
	}

	wm.activeWorkers[id] = w

	wm.logger.Info("Started worker",
		zap.String("id", id),
		zap.String("taskQueue", taskQueue),
		zap.String("workerType", string(wtype)),
	)

	return nil
}

// ---------------------------------------------------------------------------
// Temporal logger adapter
// ---------------------------------------------------------------------------

// temporalLogger adapts the project's logger.Logger to the Temporal SDK's
// log.Logger interface.
type temporalLogger struct {
	l *logger.Logger
}

func newTemporalLogger(l *logger.Logger) *temporalLogger {
	return &temporalLogger{l: l}
}

func (t *temporalLogger) Debug(msg string, keyvals ...interface{}) {
	t.l.Debug(msg, keyvalsToFields(keyvals)...)
}

func (t *temporalLogger) Info(msg string, keyvals ...interface{}) {
	t.l.Info(msg, keyvalsToFields(keyvals)...)
}

func (t *temporalLogger) Warn(msg string, keyvals ...interface{}) {
	t.l.Warn(msg, keyvalsToFields(keyvals)...)
}

func (t *temporalLogger) Error(msg string, keyvals ...interface{}) {
	t.l.Error(msg, keyvalsToFields(keyvals)...)
}

// keyvalsToFields converts the Temporal SDK's key-value pairs into zap.Field
// slices. The Temporal logger passes alternating key/value items.
func keyvalsToFields(keyvals []interface{}) []zap.Field {
	fields := make([]zap.Field, 0, len(keyvals)/2)
	for i := 0; i+1 < len(keyvals); i += 2 {
		key, ok := keyvals[i].(string)
		if !ok {
			key = fmt.Sprintf("%v", keyvals[i])
		}
		fields = append(fields, zap.Any(key, keyvals[i+1]))
	}
	return fields
}
