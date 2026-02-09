package workmanager

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
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

// pollInterval is how frequently the WorkManager asks the Config Service for
// the latest set of worker configurations.
const pollInterval = 10 * time.Second

// MetaConfig is a single worker configuration entry returned by the Config
// Service. Each entry describes a Temporal worker that the WorkManager should
// start (or keep running).
type MetaConfig struct {
	ID         string     `json:"id"`
	WorkerType WorkerType `json:"workerType"`
	TaskQueue  string     `json:"taskQueue"`
	JobRunID   string     `json:"jobRunId,omitempty"`
}

// registrationRequest is the JSON body sent to the Config Service when the
// worker registers itself on startup.
type registrationRequest struct {
	WorkerID string `json:"workerId"`
	BuildID  string `json:"buildId"`
	Platform string `json:"platform"`
}

// registrationResponse models the JSON body returned by the Config Service
// after a successful worker registration. It may contain Redis and Temporal
// connection details that override the environment-based defaults.
type registrationResponse struct {
	Data struct {
		TemporalAddress       string `json:"temporalAddress"`
		TemporalTLSEnabled    bool   `json:"temporalTlsEnabled"`
		TemporalTLSCACert     string `json:"temporalTlsCaCert"`
		TemporalTLSServerName string `json:"temporalTlsServerName"`
		TemporalJWTEnabled    bool   `json:"temporalJwtEnabled"`
		RedisHost             string `json:"redisHost"`
		RedisPort             string `json:"redisPort"`
		RedisUsername         string `json:"redisUsername"`
		RedisPassword         string `json:"redisPassword"`
	} `json:"data"`
}

// configListResponse models the JSON body returned when polling for the
// current set of worker configurations.
type configListResponse struct {
	Data []MetaConfig `json:"data"`
}

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
	regResp, err := wm.register(ctx)
	if err != nil {
		return fmt.Errorf("workmanager: registration failed: %w", err)
	}

	// Step 2: Apply any overrides from the registration response.
	wm.applyRegistrationOverrides(regResp)

	// Step 3: Create the Temporal client.
	tc, err := wm.createTemporalClient()
	if err != nil {
		return fmt.Errorf("workmanager: creating temporal client: %w", err)
	}
	wm.temporalClient = tc

	// Step 4: Run an initial configuration fetch so that workers are started
	// before we enter the ticker loop.
	if err := wm.handleConfigurations(ctx); err != nil {
		wm.logger.Warn("workmanager: initial configuration fetch failed", zap.Error(err))
	}

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

// register sends a POST to the Config Service to announce this worker.
func (wm *WorkManager) register(ctx context.Context) (*registrationResponse, error) {
	platform := runtime.GOOS
	body := registrationRequest{
		WorkerID: wm.cfg.WorkerID,
		BuildID:  wm.cfg.BuildID,
		Platform: platform,
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

	var regResp registrationResponse
	if err := json.Unmarshal(resp.Body, &regResp); err != nil {
		return nil, fmt.Errorf("decoding registration response: %w", err)
	}

	wm.logger.Info("Registered with Config Service",
		zap.String("workerId", wm.cfg.WorkerID),
		zap.String("platform", platform),
	)

	return &regResp, nil
}

// applyRegistrationOverrides updates the Config with values returned by the
// Config Service registration endpoint, when they are non-empty.
func (wm *WorkManager) applyRegistrationOverrides(resp *registrationResponse) {
	if resp == nil {
		return
	}
	d := resp.Data

	if d.TemporalAddress != "" {
		wm.cfg.TemporalAddress = d.TemporalAddress
	}
	if d.TemporalTLSCACert != "" {
		wm.cfg.TemporalTLSCACert = d.TemporalTLSCACert
		wm.cfg.TemporalTLSEnabled = d.TemporalTLSEnabled
	}
	if d.TemporalTLSServerName != "" {
		wm.cfg.TemporalTLSServerName = d.TemporalTLSServerName
	}
	if d.RedisHost != "" {
		wm.cfg.RedisHost = d.RedisHost
	}
	if d.RedisPort != "" {
		wm.cfg.RedisPort = d.RedisPort
	}
	if d.RedisUsername != "" {
		wm.cfg.RedisUsername = d.RedisUsername
	}
	if d.RedisPassword != "" {
		wm.cfg.RedisPassword = d.RedisPassword
	}
}

// createTemporalClient builds a Temporal SDK client using the current
// Config values for address, TLS, and JWT.
func (wm *WorkManager) createTemporalClient() (client.Client, error) {
	opts := client.Options{
		HostPort:  wm.cfg.TemporalAddress,
		Namespace: "default",
		Logger:    newTemporalLogger(wm.logger),
	}

	// Configure mTLS if enabled.
	if wm.cfg.TemporalTLSEnabled && wm.cfg.TemporalTLSCACert != "" {
		certPool := x509.NewCertPool()
		if !certPool.AppendCertsFromPEM([]byte(wm.cfg.TemporalTLSCACert)) {
			return nil, fmt.Errorf("failed to parse Temporal TLS CA certificate")
		}

		tlsCfg := &tls.Config{
			RootCAs:    certPool,
			MinVersion: tls.VersionTLS12,
		}

		if wm.cfg.TemporalTLSServerName != "" {
			tlsCfg.ServerName = wm.cfg.TemporalTLSServerName
		}

		opts.ConnectionOptions = client.ConnectionOptions{
			TLS: tlsCfg,
		}
	}

	return client.Dial(opts)
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

// handleConfigurations fetches the current list of MetaConfig entries from the
// Config Service and reconciles them with the set of running workers -- starting
// new ones and stopping stale ones.
func (wm *WorkManager) handleConfigurations(ctx context.Context) error {
	url := fmt.Sprintf("%s/api/v1/work-manager/config/%s",
		strings.TrimRight(wm.cfg.ConfigServiceURL, "/"),
		wm.cfg.WorkerID,
	)

	resp, err := wm.httpClient.Get(url, nil)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned status %d: %s", url, resp.StatusCode, string(resp.Body))
	}

	var configs configListResponse
	if err := json.Unmarshal(resp.Body, &configs); err != nil {
		return fmt.Errorf("decoding config response: %w", err)
	}

	// Build a set of desired worker IDs for quick lookup.
	desired := make(map[string]MetaConfig, len(configs.Data))
	for _, mc := range configs.Data {
		desired[mc.ID] = mc
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	// Start workers that are desired but not yet running.
	for id, mc := range desired {
		if _, running := wm.activeWorkers[id]; !running {
			if err := wm.startWorker(id, mc); err != nil {
				wm.logger.Error("workmanager: failed to start worker",
					zap.String("id", id),
					zap.String("taskQueue", mc.TaskQueue),
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

	return nil
}

// startWorker creates a new Temporal worker for the given MetaConfig, registers
// the appropriate workflows and activities, starts the worker, and records it
// in the active set. Caller must hold wm.mu.
func (wm *WorkManager) startWorker(id string, meta MetaConfig) error {
	opts := worker.Options{
		MaxConcurrentActivityExecutionSize: wm.cfg.MaxActivityConcurrency,
	}

	w := worker.New(wm.temporalClient, meta.TaskQueue, opts)

	registerWorkflows(w, meta.WorkerType)
	registerActivities(w, wm.activities, meta.WorkerType)

	if err := w.Start(); err != nil {
		return fmt.Errorf("starting temporal worker on queue %s: %w", meta.TaskQueue, err)
	}

	wm.activeWorkers[id] = w

	wm.logger.Info("Started worker",
		zap.String("id", id),
		zap.String("taskQueue", meta.TaskQueue),
		zap.String("workerType", string(meta.WorkerType)),
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
