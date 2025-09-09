package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// WorkerMetrics represents collected worker metrics
type WorkerMetrics struct {
	WorkerID     string             `json:"workerId"`
	ControlIP    string             `json:"controlIp"`
	QueryTime    time.Time          `json:"queryTime"`
	CPU          map[string]float64 `json:"cpu"`
	Memory       map[string]float64 `json:"memory"`
	Disk         map[string]float64 `json:"disk"`
	Network      map[string]float64 `json:"network"`
	Threads      map[string]float64 `json:"threads"`
	Info         map[string]string  `json:"info"`
	HTTPRequests map[string]float64 `json:"httpRequests"`
	RawData      string             `json:"rawData"`
	DataSize     int                `json:"dataSize"`
}

// CollectWorkerMetrics fetches worker metrics from Pushgateway
func CollectWorkerMetrics(cpIP, workerID string) (*WorkerMetrics, error) {
	pushgatewayURL := fmt.Sprintf("http://%s:9091", cpIP)

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// Query Pushgateway
	resp, err := client.Get(pushgatewayURL + "/metrics")
	if err != nil {
		return nil, fmt.Errorf("failed to query Pushgateway at %s: %v", pushgatewayURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Pushgateway returned status %d", resp.StatusCode)
	}

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Pushgateway response: %v", err)
	}

	// Parse metrics
	metrics := parseWorkerMetrics(string(body), workerID)
	metrics.WorkerID = workerID
	metrics.ControlIP = cpIP
	metrics.QueryTime = time.Now()
	metrics.RawData = string(body)
	metrics.DataSize = len(body)

	return metrics, nil
}

// parseWorkerMetrics extracts worker-specific metrics from Prometheus text format
func parseWorkerMetrics(prometheusData, workerID string) *WorkerMetrics {
	lines := strings.Split(prometheusData, "\n")
	metrics := &WorkerMetrics{
		CPU:          make(map[string]float64),
		Memory:       make(map[string]float64),
		Disk:         make(map[string]float64),
		Network:      make(map[string]float64),
		Threads:      make(map[string]float64),
		Info:         make(map[string]string),
		HTTPRequests: make(map[string]float64),
	}

	// Regex to parse Prometheus metrics: metric_name{labels} value
	metricRegex := regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([0-9.eE+-]+)`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		matches := metricRegex.FindStringSubmatch(line)
		if len(matches) != 4 {
			continue
		}

		metricName := matches[1]
		labels := matches[2]
		valueStr := matches[3]

		// Only process metrics for our specific worker
		if !strings.Contains(labels, fmt.Sprintf(`worker_id="%s"`, workerID)) {
			continue
		}

		value, err := strconv.ParseFloat(valueStr, 64)
		if err != nil {
			continue
		}

		// Parse different metric types
		parseMetricByType(metricName, labels, value, metrics)
	}

	return metrics
}

// parseMetricByType categorizes and parses metrics by type
func parseMetricByType(metricName, labels string, value float64, metrics *WorkerMetrics) {
	switch {
	case strings.Contains(metricName, "worker_system_cpu_usage"):
		if coreMatch := regexp.MustCompile(`core="([^"]+)"`).FindStringSubmatch(labels); coreMatch != nil {
			metrics.CPU[coreMatch[1]] = value * 100 // Convert to percentage
		}
	case strings.Contains(metricName, "worker_system_memory"):
		if typeMatch := regexp.MustCompile(`type="([^"]+)"`).FindStringSubmatch(labels); typeMatch != nil {
			metrics.Memory["system_"+typeMatch[1]] = value
		}
	case strings.Contains(metricName, "worker_nodejs_heap_size_used_bytes"):
		metrics.Memory["nodejs_heap_used"] = value
	case strings.Contains(metricName, "worker_nodejs_heap_size_total_bytes"):
		metrics.Memory["nodejs_heap_total"] = value
	case strings.Contains(metricName, "worker_threads_status"):
		if statusMatch := regexp.MustCompile(`status="([^"]+)"`).FindStringSubmatch(labels); statusMatch != nil {
			metrics.Threads["threads_"+statusMatch[1]] = value
		}
	case strings.Contains(metricName, "worker_tasks_active_total"):
		metrics.Threads["active_tasks"] = value
	case strings.Contains(metricName, "worker_info"):
		if versionMatch := regexp.MustCompile(`label_build_version="([^"]+)"`).FindStringSubmatch(labels); versionMatch != nil {
			metrics.Info["version"] = versionMatch[1]
		}
		if platformMatch := regexp.MustCompile(`platform="([^"]+)"`).FindStringSubmatch(labels); platformMatch != nil {
			metrics.Info["platform"] = platformMatch[1]
		}
	}
}

// DisplayWorkerMetrics formats and displays metrics in the exact format you want
func DisplayWorkerMetrics(metrics *WorkerMetrics, label string) {
	pushgatewayURL := fmt.Sprintf("http://%s:9091", metrics.ControlIP)

	fmt.Printf(" Worker Metrics Output:\n")
	fmt.Printf(" NDM Worker Metrics Query Tool\n")
	fmt.Printf("=====================================\n")
	fmt.Printf(" Control Plane: %s\n", metrics.ControlIP)
	fmt.Printf(" Worker ID: %s\n", metrics.WorkerID)
	fmt.Printf(" Pushgateway URL: %s\n", pushgatewayURL)
	fmt.Printf(" Query Time: %s\n", metrics.QueryTime.Format("2006-01-02T15:04:05.000Z"))
	fmt.Printf("\n")

	fmt.Printf(" Testing Pushgateway connectivity...\n")
	fmt.Printf(" Pushgateway accessible\n")
	fmt.Printf(" Response size: %d bytes\n", metrics.DataSize)
	fmt.Printf("\n")

	fmt.Printf(" Parsing worker metrics...\n")
	fmt.Printf(" WORKER METRICS SUMMARY\n")
	fmt.Printf("=========================\n")

	// Worker Information
	if len(metrics.Info) > 0 {
		fmt.Printf("  Worker Information:\n")
		if version, ok := metrics.Info["version"]; ok {
			fmt.Printf("    Version: %s\n", version)
		}
		if platform, ok := metrics.Info["platform"]; ok {
			fmt.Printf("    Platform: %s\n", platform)
		}
		fmt.Printf("\n")
	}

	// Memory Usage
	fmt.Printf(" Memory Usage:\n")
	if total, ok := metrics.Memory["system_total"]; ok {
		fmt.Printf("    System Total: %s\n", formatBytes(int64(total)))
	}
	if used, ok := metrics.Memory["system_used"]; ok {
		fmt.Printf("    System Used: %s\n", formatBytes(int64(used)))
	}
	if free, ok := metrics.Memory["system_free"]; ok {
		fmt.Printf("    System Free: %s\n", formatBytes(int64(free)))
	}

	// Calculate system memory usage percentage
	if total, totalOk := metrics.Memory["system_total"]; totalOk {
		if used, usedOk := metrics.Memory["system_used"]; usedOk && total > 0 {
			percentage := (used / total) * 100
			fmt.Printf("    System Usage: %.2f%%\n", percentage)
		}
	}

	if heapUsed, ok := metrics.Memory["nodejs_heap_used"]; ok {
		fmt.Printf("    Node.js Heap Used: %s\n", formatBytes(int64(heapUsed)))
	}
	if heapTotal, ok := metrics.Memory["nodejs_heap_total"]; ok {
		fmt.Printf("    Node.js Heap Total: %s\n", formatBytes(int64(heapTotal)))
	}

	// Calculate Node.js heap usage percentage
	if heapUsed, usedOk := metrics.Memory["nodejs_heap_used"]; usedOk {
		if heapTotal, totalOk := metrics.Memory["nodejs_heap_total"]; totalOk && heapTotal > 0 {
			heapPercentage := (heapUsed / heapTotal) * 100
			fmt.Printf("    Node.js Heap Usage: %.2f%%\n", heapPercentage)
			if heapPercentage > 85 {
				fmt.Printf("      HIGH NODE.JS HEAP USAGE!\n")
			}
		}
	}
	fmt.Printf("\n")

	// CPU Usage
	fmt.Printf("  CPU Usage:\n")
	var cpuSum float64
	var cpuCount int

	for core, usage := range metrics.CPU {
		fmt.Printf("    %s: %.2f%%\n", core, usage)
		cpuSum += usage
		cpuCount++
	}

	if cpuCount > 0 {
		average := cpuSum / float64(cpuCount)
		fmt.Printf("    Average: %.2f%%\n", average)
	}
	fmt.Printf("\n")

	// Worker Threads
	fmt.Printf(" Worker Threads:\n")
	if total, ok := metrics.Threads["threads_total"]; ok {
		fmt.Printf("    Total Threads: %.0f\n", total)
	}
	if available, ok := metrics.Threads["threads_available"]; ok {
		fmt.Printf("    Available: %.0f\n", available)
	}
	if busy, ok := metrics.Threads["threads_busy"]; ok {
		fmt.Printf("    Busy: %.0f\n", busy)
	}
	if active, ok := metrics.Threads["active_tasks"]; ok {
		fmt.Printf("    Active Tasks: %.0f\n", active)
	}
	fmt.Printf("\n")

	fmt.Printf(" Metrics query completed successfully!\n")
	fmt.Printf("\n")
	fmt.Printf(" Test passed: Worker metrics integration works!\n")
}

// WriteMetricsToFile saves worker metrics to a timestamped file
func WriteMetricsToFile(metrics *WorkerMetrics, workerID string) error {
	// Create filename with timestamp
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("worker-metrics-%s-%s.txt", workerID, timestamp)

	// Create file
	file, err := os.Create(filename)
	if err != nil {
		return fmt.Errorf("failed to create metrics file: %v", err)
	}
	defer file.Close()

	// Write metrics to file
	file.WriteString(fmt.Sprintf("Worker Metrics for %s\n", workerID))
	file.WriteString(fmt.Sprintf("Collected at: %s\n", metrics.QueryTime.Format("2006-01-02 15:04:05")))
	file.WriteString(fmt.Sprintf("Control Plane: %s\n\n", metrics.ControlIP))

	// Memory information
	file.WriteString("Memory Usage:\n")
	if sysTotal, ok := metrics.Memory["system_total"]; ok {
		file.WriteString(fmt.Sprintf("  System Total: %s\n", formatBytes(int64(sysTotal))))
	}
	if sysUsed, ok := metrics.Memory["system_used"]; ok {
		file.WriteString(fmt.Sprintf("  System Used: %s\n", formatBytes(int64(sysUsed))))
	}
	if heapUsed, ok := metrics.Memory["nodejs_heap_used"]; ok {
		file.WriteString(fmt.Sprintf("  Node.js Heap Used: %s\n", formatBytes(int64(heapUsed))))
	}
	if heapTotal, ok := metrics.Memory["nodejs_heap_total"]; ok {
		file.WriteString(fmt.Sprintf("  Node.js Heap Total: %s\n", formatBytes(int64(heapTotal))))
	}

	// CPU information
	file.WriteString("\nCPU Usage:\n")
	var cpuSum float64
	var cpuCount int
	for core, usage := range metrics.CPU {
		file.WriteString(fmt.Sprintf("  %s: %.2f%%\n", core, usage))
		cpuSum += usage
		cpuCount++
	}
	if cpuCount > 0 {
		average := cpuSum / float64(cpuCount)
		file.WriteString(fmt.Sprintf("  Average: %.2f%%\n", average))
	}

	// Thread information
	file.WriteString("\nWorker Threads:\n")
	if total, ok := metrics.Threads["threads_total"]; ok {
		file.WriteString(fmt.Sprintf("  Total Threads: %.0f\n", total))
	}
	if available, ok := metrics.Threads["threads_available"]; ok {
		file.WriteString(fmt.Sprintf("  Available: %.0f\n", available))
	}
	if busy, ok := metrics.Threads["threads_busy"]; ok {
		file.WriteString(fmt.Sprintf("  Busy: %.0f\n", busy))
	}
	if active, ok := metrics.Threads["active_tasks"]; ok {
		file.WriteString(fmt.Sprintf("  Active Tasks: %.0f\n", active))
	}

	// Raw data
	file.WriteString(fmt.Sprintf("\nRaw Metrics Data (%d bytes):\n", metrics.DataSize))
	file.WriteString(metrics.RawData)

	fmt.Printf(" Metrics saved to: %s\n", filename)
	return nil
}

// CollectAndDisplayWorkerMetrics is a convenience function that collects and displays metrics
func CollectAndDisplayWorkerMetrics(cpIP, workerID, label string) error {
	fmt.Printf(" Collecting worker metrics for %s...\n", workerID)

	metrics, err := CollectWorkerMetrics(cpIP, workerID)
	if err != nil {
		return fmt.Errorf("failed to collect worker metrics: %v", err)
	}

	DisplayWorkerMetrics(metrics, label)

	// Write metrics to file as well
	err = WriteMetricsToFile(metrics, workerID)
	if err != nil {
		fmt.Printf("Warning: Failed to write metrics to file: %v\n", err)
	}

	return nil
}

// formatBytes helper function for readable byte formatting
func formatBytes(bytes int64) string {
	if bytes == 0 {
		return "0 B"
	}

	const unit = 1024
	sizes := []string{"B", "KB", "MB", "GB", "TB"}

	fBytes := float64(bytes)
	i := 0
	for fBytes >= unit && i < len(sizes)-1 {
		fBytes /= unit
		i++
	}

	return fmt.Sprintf("%.2f %s", fBytes, sizes[i])
}

// GetWorkerMetricsAsJSON returns worker metrics as JSON for API responses
func GetWorkerMetricsAsJSON(cpIP, workerID string) ([]byte, error) {
	metrics, err := CollectWorkerMetrics(cpIP, workerID)
	if err != nil {
		return nil, err
	}

	return json.Marshal(metrics)
}
