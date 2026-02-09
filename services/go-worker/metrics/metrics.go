package metrics

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/common/expfmt"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// pushInterval controls how often metrics are serialized and pushed to the
// Prometheus Pushgateway.
const pushInterval = 15 * time.Second

// ---------------------------------------------------------------------------
// Prometheus metrics -- these mirror the 11 metrics defined by the TS worker.
// ---------------------------------------------------------------------------

var (
	// HTTPRequestsTotal counts all outgoing HTTP requests made by the worker,
	// labelled by method, URL, and response status.
	HTTPRequestsTotal *prometheus.CounterVec

	// SystemCPUUsage reports the latest CPU utilization percentage.
	SystemCPUUsage prometheus.Gauge

	// SystemMemory reports the latest memory utilization percentage.
	SystemMemory prometheus.Gauge

	// SystemDiskUsage reports the latest disk utilization percentage.
	SystemDiskUsage prometheus.Gauge

	// SystemNetworkIO tracks bytes sent and received, labelled by direction
	// ("tx" or "rx").
	SystemNetworkIO *prometheus.GaugeVec

	// WorkerInfo exposes static worker metadata as labels (workerID, buildID,
	// platform, version).
	WorkerInfo *prometheus.GaugeVec

	// ThreadsStatus tracks the number of copy-pool threads in each state
	// ("active", "idle").
	ThreadsStatus *prometheus.GaugeVec

	// TasksQueueDepth reports the number of copy tasks waiting in the queue.
	TasksQueueDepth prometheus.Gauge

	// TasksActiveTotal reports the number of copy tasks currently being
	// processed.
	TasksActiveTotal prometheus.Gauge

	// ThreadErrorsTotal counts the total number of thread-level copy errors.
	ThreadErrorsTotal prometheus.Counter

	// NetworkLatency records network round-trip times to external services,
	// labelled by target.
	NetworkLatency *prometheus.HistogramVec
)

// registry is a dedicated Prometheus registry so we do not pollute the
// global default registry with the worker metrics.
var registry *prometheus.Registry

// Init creates and registers all Prometheus metrics. It should be called once
// at startup, before StartPushLoop.
func Init(workerID, buildID string) {
	registry = prometheus.NewRegistry()

	HTTPRequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "worker_http_requests_total",
		Help: "Total HTTP requests made by the worker",
	}, []string{"method", "url", "status"})

	SystemCPUUsage = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "worker_system_cpu_usage",
		Help: "Current CPU usage percentage",
	})

	SystemMemory = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "worker_system_memory",
		Help: "Current memory usage percentage",
	})

	SystemDiskUsage = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "worker_system_disk_usage",
		Help: "Current disk usage percentage",
	})

	SystemNetworkIO = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "worker_system_network_io",
		Help: "Network I/O bytes by direction",
	}, []string{"direction"})

	WorkerInfo = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "worker_info",
		Help: "Static worker metadata",
	}, []string{"worker_id", "build_id", "platform", "version"})

	ThreadsStatus = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "worker_threads_status",
		Help: "Copy pool thread counts by state",
	}, []string{"state"})

	TasksQueueDepth = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "worker_tasks_queue_depth",
		Help: "Number of tasks waiting in the copy queue",
	})

	TasksActiveTotal = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "worker_tasks_active_total",
		Help: "Number of tasks currently being processed",
	})

	ThreadErrorsTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "worker_thread_errors_total",
		Help: "Total copy thread errors",
	})

	NetworkLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "worker_network_latency",
		Help:    "Network latency to external services",
		Buckets: prometheus.DefBuckets,
	}, []string{"target"})

	// Register all collectors.
	registry.MustRegister(
		HTTPRequestsTotal,
		SystemCPUUsage,
		SystemMemory,
		SystemDiskUsage,
		SystemNetworkIO,
		WorkerInfo,
		ThreadsStatus,
		TasksQueueDepth,
		TasksActiveTotal,
		ThreadErrorsTotal,
		NetworkLatency,
	)

	// Set the static worker_info gauge so it appears immediately.
	WorkerInfo.With(prometheus.Labels{
		"worker_id": workerID,
		"build_id":  buildID,
		"platform":  "linux",
		"version":   buildID,
	}).Set(1)
}

// StartPushLoop launches a background goroutine that serializes all registered
// metrics using the Prometheus exposition format and POSTs them to the
// Pushgateway at http://<ControlPlaneIP>:9091 every pushInterval.
// The goroutine exits when ctx is cancelled.
func StartPushLoop(ctx context.Context, cfg *config.Config, log *logger.Logger) {
	if cfg.ControlPlaneIP == "" {
		log.Warn("metrics: CONTROL_PLANE_IP not set, push loop disabled")
		return
	}

	pushURL := fmt.Sprintf("http://%s:9091/metrics/job/go-worker/instance/%s",
		cfg.ControlPlaneIP, cfg.WorkerID)

	go pushLoop(ctx, pushURL, log)
}

// pushLoop runs the periodic push ticker.
func pushLoop(ctx context.Context, pushURL string, log *logger.Logger) {
	ticker := time.NewTicker(pushInterval)
	defer ticker.Stop()

	httpClient := &http.Client{Timeout: 10 * time.Second}

	for {
		select {
		case <-ctx.Done():
			log.Info("metrics: push loop stopping")
			return
		case <-ticker.C:
			if err := pushMetrics(httpClient, pushURL); err != nil {
				log.Warn("metrics: push failed",
					zap.String("url", logger.MaskIPs(pushURL)),
					zap.Error(err),
				)
			}
		}
	}
}

// pushMetrics gathers all metrics from the registry, serializes them using
// the Prometheus text exposition format, and POSTs them to the Pushgateway.
func pushMetrics(httpClient *http.Client, pushURL string) error {
	mfs, err := registry.Gather()
	if err != nil {
		return fmt.Errorf("gathering metrics: %w", err)
	}

	var buf bytes.Buffer
	enc := expfmt.NewEncoder(&buf, expfmt.NewFormat(expfmt.TypeTextPlain))
	for _, mf := range mfs {
		if err := enc.Encode(mf); err != nil {
			return fmt.Errorf("encoding metric family %s: %w", mf.GetName(), err)
		}
	}

	req, err := http.NewRequest(http.MethodPost, pushURL, &buf)
	if err != nil {
		return fmt.Errorf("creating push request: %w", err)
	}
	req.Header.Set("Content-Type", string(expfmt.NewFormat(expfmt.TypeTextPlain)))

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("executing push request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("pushgateway returned status %d", resp.StatusCode)
	}

	return nil
}

// RecordHTTPRequest is a convenience function to increment the
// HTTPRequestsTotal counter after an HTTP call.
func RecordHTTPRequest(method, url string, statusCode int) {
	if HTTPRequestsTotal == nil {
		return
	}
	// Truncate the URL to the path component to avoid high-cardinality labels.
	urlLabel := url
	if idx := strings.Index(url, "?"); idx != -1 {
		urlLabel = url[:idx]
	}
	HTTPRequestsTotal.With(prometheus.Labels{
		"method": method,
		"url":    urlLabel,
		"status": fmt.Sprintf("%d", statusCode),
	}).Inc()
}

// RecordNetworkLatency is a convenience function to observe a latency sample
// for the given target.
func RecordNetworkLatency(target string, d time.Duration) {
	if NetworkLatency == nil {
		return
	}
	NetworkLatency.With(prometheus.Labels{
		"target": target,
	}).Observe(d.Seconds())
}
