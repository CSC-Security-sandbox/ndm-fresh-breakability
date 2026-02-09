package healthcheck

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"go.uber.org/zap"
	"golang.org/x/sys/unix"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/httpclient"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// ---------------------------------------------------------------------------
// JSON payload — matches the TypeScript worker's HealthcheckPayload type that
// the jobs-service POST /statscheck endpoint expects.
// ---------------------------------------------------------------------------

// systemStats mirrors the TypeScript SystemStats interface. All fields are
// formatted strings (e.g. "45.67%", "16.00GB") to match the TS worker.
type systemStats struct {
	CPUUsage    string `json:"cpuUsage"`
	MemoryUsage string `json:"memoryUsage"`
	MemoryLimit string `json:"memoryLimit"`
	DiskUsage   string `json:"diskUsage"`
	DiskLimit   string `json:"diskLimit"`
}

// statsPayload is the JSON body posted to the Job Service statscheck endpoint.
// It mirrors the TS HealthcheckPayload: { workerId, healthStatus, systemStats }.
type statsPayload struct {
	WorkerID     string      `json:"workerId"`
	HealthStatus string      `json:"healthStatus"`
	SystemStats  systemStats `json:"systemStats"`
}

// cpuTimes holds cumulative CPU time counters.
type cpuTimes struct {
	idle  uint64
	total uint64
}

// Start launches a background goroutine that periodically collects system
// stats (CPU, memory, disk) and reports them to the Job Service. The
// goroutine exits when ctx is cancelled.
func Start(ctx context.Context, cfg *config.Config, httpClient *httpclient.Client, log *logger.Logger) {
	interval := time.Duration(cfg.HealthCheckInterval) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}

	go run(ctx, cfg, httpClient, log, interval)
}

// run is the ticker loop that collects and posts stats.
func run(ctx context.Context, cfg *config.Config, httpClient *httpclient.Client, log *logger.Logger, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// We need a previous CPU sample to calculate delta usage.
	prevCPU, err := readCPUTimes()
	if err != nil {
		log.Warn("healthcheck: initial CPU read failed, will retry", zap.Error(err))
	}

	log.Info("healthcheck: started",
		zap.Duration("interval", interval),
		zap.String("jobServiceURL", cfg.JobServiceURL),
	)

	for {
		select {
		case <-ctx.Done():
			log.Info("healthcheck: stopping")
			return
		case <-ticker.C:
			// -- CPU --
			cpuStr := "-1"
			curCPU, err := readCPUTimes()
			if err != nil {
				log.Warn("healthcheck: failed to read CPU times", zap.Error(err))
			} else {
				cpuPct := calculateCPUPercent(prevCPU, curCPU)
				prevCPU = curCPU
				cpuStr = fmt.Sprintf("%.2f%%", cpuPct)
			}

			// -- Memory --
			memUsageStr, memLimitStr := getMemoryStats()

			// -- Disk --
			diskUsageStr, diskLimitStr := getDiskStats(cfg.BaseWorkingPath)

			payload := statsPayload{
				WorkerID:     cfg.WorkerID,
				HealthStatus: "HEALTHY",
				SystemStats: systemStats{
					CPUUsage:    cpuStr,
					MemoryUsage: memUsageStr,
					MemoryLimit: memLimitStr,
					DiskUsage:   diskUsageStr,
					DiskLimit:   diskLimitStr,
				},
			}

			body, err := json.Marshal(payload)
			if err != nil {
				log.Warn("healthcheck: failed to marshal stats", zap.Error(err))
				continue
			}

			url := fmt.Sprintf("%s/api/v1/statscheck",
				strings.TrimRight(cfg.JobServiceURL, "/"))

			resp, err := httpClient.Post(url, body, nil)
			if err != nil {
				log.Warn("healthcheck: failed to post stats", zap.Error(err))
				continue
			}

			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				log.Warn("healthcheck: stats endpoint returned non-2xx",
					zap.Int("status", resp.StatusCode),
					zap.String("body", string(resp.Body)),
				)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// CPU helpers (shared)
// ---------------------------------------------------------------------------

// calculateCPUPercent computes the CPU usage percentage between two samples.
func calculateCPUPercent(prev, cur cpuTimes) float64 {
	totalDelta := cur.total - prev.total
	idleDelta := cur.idle - prev.idle

	if totalDelta == 0 {
		return 0
	}

	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100.0
}

// ---------------------------------------------------------------------------
// Memory (cross-platform using syscall.Sysinfo on Linux, sysctl on Darwin)
// ---------------------------------------------------------------------------

// getMemoryStats returns memory usage and limit as formatted strings matching
// the TS worker: "45.67%" and "16.00GB". Returns "-1" on error.
func getMemoryStats() (usageStr, limitStr string) {
	totalBytes, freeBytes, err := getSystemMemory()
	if err != nil || totalBytes == 0 {
		return "-1", "-1"
	}

	usedBytes := totalBytes - freeBytes
	usagePct := float64(usedBytes) / float64(totalBytes) * 100.0
	limitGB := float64(totalBytes) / (1024 * 1024 * 1024)

	return fmt.Sprintf("%.2f%%", usagePct), fmt.Sprintf("%.2fGB", limitGB)
}

// ---------------------------------------------------------------------------
// Disk (cross-platform — unix.Statfs works on both Linux and Darwin)
// ---------------------------------------------------------------------------

// getDiskStats returns disk usage and limit as formatted strings matching
// the TS worker: "62.15%" and "500.00GB". Returns "-1" on error.
func getDiskStats(path string) (usageStr, limitStr string) {
	if path == "" {
		path = "/"
	}

	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return "-1", "-1"
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)

	if total == 0 {
		return "-1", "-1"
	}

	used := total - free
	usagePct := float64(used) / float64(total) * 100.0
	limitGB := float64(total) / (1024 * 1024 * 1024)

	return fmt.Sprintf("%.2f%%", usagePct), fmt.Sprintf("%.2fGB", limitGB)
}
