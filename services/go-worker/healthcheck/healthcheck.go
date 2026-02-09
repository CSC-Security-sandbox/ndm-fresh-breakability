//go:build linux

package healthcheck

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"
	"golang.org/x/sys/unix"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/httpclient"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// statsPayload is the JSON body posted to the Job Service statscheck endpoint.
type statsPayload struct {
	WorkerID  string  `json:"workerId"`
	CPU       float64 `json:"cpu"`
	Memory    float64 `json:"memory"`
	Disk      float64 `json:"disk"`
	Timestamp string  `json:"timestamp"`
}

// cpuTimes holds the cumulative CPU time counters read from /proc/stat.
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

	for {
		select {
		case <-ctx.Done():
			log.Info("healthcheck: stopping")
			return
		case <-ticker.C:
			curCPU, err := readCPUTimes()
			if err != nil {
				log.Warn("healthcheck: failed to read CPU times", zap.Error(err))
				continue
			}

			cpuPct := calculateCPUPercent(prevCPU, curCPU)
			prevCPU = curCPU

			memPct := getMemoryPercent()
			diskPct := getDiskPercent(cfg.BaseWorkingPath)

			payload := statsPayload{
				WorkerID:  cfg.WorkerID,
				CPU:       cpuPct,
				Memory:    memPct,
				Disk:      diskPct,
				Timestamp: time.Now().UTC().Format(time.RFC3339),
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
// CPU usage (from /proc/stat)
// ---------------------------------------------------------------------------

// readCPUTimes parses the aggregate CPU line from /proc/stat and returns the
// idle and total tick counters.
func readCPUTimes() (cpuTimes, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuTimes{}, fmt.Errorf("opening /proc/stat: %w", err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 5 {
			return cpuTimes{}, fmt.Errorf("unexpected /proc/stat cpu line: %s", line)
		}

		// Fields: cpu user nice system idle iowait irq softirq steal guest guest_nice
		var total uint64
		var idle uint64
		for i, f := range fields[1:] {
			val, err := strconv.ParseUint(f, 10, 64)
			if err != nil {
				continue
			}
			total += val
			if i == 3 { // idle is the 4th numeric field (index 3)
				idle = val
			}
		}

		return cpuTimes{idle: idle, total: total}, nil
	}

	return cpuTimes{}, fmt.Errorf("cpu line not found in /proc/stat")
}

// calculateCPUPercent computes the CPU usage percentage between two samples.
func calculateCPUPercent(prev, cur cpuTimes) float64 {
	totalDelta := cur.total - prev.total
	idleDelta := cur.idle - prev.idle

	if totalDelta == 0 {
		return 0
	}

	usage := float64(totalDelta-idleDelta) / float64(totalDelta) * 100.0
	return usage
}

// ---------------------------------------------------------------------------
// Memory usage
// ---------------------------------------------------------------------------

// getMemoryPercent returns the percentage of heap memory in use via the Go
// runtime. On Linux this gives a reasonable view of the worker process memory.
// For system-wide memory, /proc/meminfo could be parsed instead.
func getMemoryPercent() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	// Sys is the total memory obtained from the OS; Alloc is currently in use.
	if m.Sys == 0 {
		return 0
	}
	return float64(m.Alloc) / float64(m.Sys) * 100.0
}

// ---------------------------------------------------------------------------
// Disk usage (syscall.Statfs)
// ---------------------------------------------------------------------------

// getDiskPercent returns the used disk percentage for the filesystem
// containing the given path.
func getDiskPercent(path string) float64 {
	if path == "" {
		path = "/"
	}

	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)

	if total == 0 {
		return 0
	}

	used := total - free
	return float64(used) / float64(total) * 100.0
}
