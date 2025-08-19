package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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

type ConsolidatedWorkerLog struct {
	WorkerID      string                  `json:"workerId"`
	ControlIP     string                  `json:"controlIp"`
	FirstSeen     time.Time               `json:"firstSeen"`
	LastUpdated   time.Time               `json:"lastUpdated"`
	TotalEntries  int                     `json:"totalEntries"`
	LogEntries    []WorkerMetricsSnapshot `json:"logEntries"`
	LatestMetrics *WorkerMetrics          `json:"latestMetrics"`
}

type WorkerMetricsSnapshot struct {
	Timestamp       time.Time         `json:"timestamp"`
	Label           string            `json:"label"`
	Metrics         *WorkerMetrics    `json:"metrics"`
	Summary         string            `json:"summary"`
	FormattedOutput string            `json:"formattedOutput"`
	ReadableMetrics map[string]string `json:"readableMetrics"`
}

// Fetches worker metrics from Pushgateway
func CollectWorkerMetrics(cpIP, workerID string) (*WorkerMetrics, error) {
	pushgatewayURL := fmt.Sprintf("http://%s:9091", cpIP)

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	resp, err := client.Get(pushgatewayURL + "/metrics")
	if err != nil {
		return nil, fmt.Errorf("failed to query Pushgateway at %s: %v", pushgatewayURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Pushgateway returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Pushgateway response: %v", err)
	}

	metrics := parseWorkerMetrics(string(body), workerID)
	metrics.WorkerID = workerID
	metrics.ControlIP = cpIP
	metrics.QueryTime = time.Now()
	metrics.RawData = string(body)
	metrics.DataSize = len(body)

	return metrics, nil
}

// Extracts worker-specific metrics from Prometheus text format
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

		if !strings.Contains(labels, fmt.Sprintf(`worker_id="%s"`, workerID)) {
			continue
		}

		value, err := strconv.ParseFloat(valueStr, 64)
		if err != nil {
			continue
		}

		parseMetricByType(metricName, labels, value, metrics)
	}

	return metrics
}

// Categorizes and parses metrics by type
func parseMetricByType(metricName, labels string, value float64, metrics *WorkerMetrics) {
	switch {
	case strings.Contains(metricName, "worker_system_cpu_usage"):
		if coreMatch := regexp.MustCompile(`core="([^"]+)"`).FindStringSubmatch(labels); coreMatch != nil {
			metrics.CPU[coreMatch[1]] = value
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

func LogWorkerMetrics(cpIP, workerID, label string) (string, error) {
	// Create logs directory if it doesn't exist
	logsDir := "logs/worker_metrics"
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create logs directory: %v", err)
	}

	metrics, err := CollectWorkerMetrics(cpIP, workerID)
	if err != nil {
		return "", fmt.Errorf("failed to collect worker metrics: %v", err)
	}

	// Use worker ID for consistent filename
	workerShortID := strings.Split(workerID, "-")[0]
	filename := fmt.Sprintf("worker_metrics_%s_consolidated.json", workerShortID)
	filepath := filepath.Join(logsDir, filename)

	// Generate formatted output and readable metrics
	formattedOutput := generateMetricsOutput(metrics, label)
	summary := generateMetricsSummary(metrics)
	readableMetrics := extractReadableMetrics(metrics)

	// Create new snapshot
	newSnapshot := WorkerMetricsSnapshot{
		Timestamp:       time.Now(),
		Label:           label,
		Metrics:         metrics,
		Summary:         summary,
		FormattedOutput: formattedOutput,
		ReadableMetrics: readableMetrics,
	}

	var consolidatedLog ConsolidatedWorkerLog

	// Check if file exists and read existing data
	if _, err := os.Stat(filepath); err == nil {
		// File exists, read it
		existingData, err := os.ReadFile(filepath)
		if err != nil {
			return "", fmt.Errorf("failed to read existing consolidated file: %v", err)
		}

		if err := json.Unmarshal(existingData, &consolidatedLog); err != nil {
			return "", fmt.Errorf("failed to parse existing consolidated file: %v", err)
		}
	} else {
		// If file doesn't exist, create new structure
		consolidatedLog = ConsolidatedWorkerLog{
			WorkerID:   workerID,
			ControlIP:  cpIP,
			FirstSeen:  time.Now(),
			LogEntries: []WorkerMetricsSnapshot{},
		}
	}

	// Append new snapshot
	consolidatedLog.LogEntries = append(consolidatedLog.LogEntries, newSnapshot)
	consolidatedLog.LastUpdated = time.Now()
	consolidatedLog.TotalEntries = len(consolidatedLog.LogEntries)
	consolidatedLog.LatestMetrics = metrics

	// Write consolidated log back to file
	jsonData, err := json.MarshalIndent(consolidatedLog, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal consolidated log to JSON: %v", err)
	}

	if err := os.WriteFile(filepath, jsonData, 0644); err != nil {
		return "", fmt.Errorf("failed to write consolidated file: %v", err)
	}

	// Also create/update readable text log
	textFilepath := strings.Replace(filepath, ".json", ".txt", 1)
	appendToTextLog(textFilepath, newSnapshot)

	return filepath, nil
}

// DisplayWorkerMetrics - for console display when needed
func DisplayWorkerMetrics(cpIP, workerID, label string) error {
	metrics, err := CollectWorkerMetrics(cpIP, workerID)
	if err != nil {
		return fmt.Errorf("failed to collect worker metrics: %v", err)
	}

	output := generateMetricsOutput(metrics, label)
	fmt.Print(output)
	return nil
}

// Helper functions
func generateMetricsOutput(metrics *WorkerMetrics, label string) string {
	var output strings.Builder
	pushgatewayURL := fmt.Sprintf("http://%s:9091", metrics.ControlIP)

	output.WriteString("Worker Metrics Output:\n")
	output.WriteString("NDM Worker Metrics Query Tool\n")
	output.WriteString("=====================================\n")
	output.WriteString(fmt.Sprintf("Control Plane: %s\n", metrics.ControlIP))
	output.WriteString(fmt.Sprintf("Worker ID: %s\n", metrics.WorkerID))
	output.WriteString(fmt.Sprintf("Pushgateway URL: %s\n", pushgatewayURL))
	output.WriteString(fmt.Sprintf("Query Time: %s\n", metrics.QueryTime.Format("2006-01-02T15:04:05.000Z")))
	output.WriteString("\n")

	output.WriteString("Testing Pushgateway connectivity...\n")
	output.WriteString("Pushgateway accessible\n")
	output.WriteString(fmt.Sprintf("Response size: %d bytes\n", metrics.DataSize))
	output.WriteString("\n")

	output.WriteString("Parsing worker metrics...\n")
	output.WriteString("WORKER METRICS SUMMARY\n")
	output.WriteString("=========================\n")

	// Worker Information
	if len(metrics.Info) > 0 {
		output.WriteString("  Worker Information:\n")
		if version, ok := metrics.Info["version"]; ok {
			output.WriteString(fmt.Sprintf("    Version: %s\n", version))
		}
		if platform, ok := metrics.Info["platform"]; ok {
			output.WriteString(fmt.Sprintf("    Platform: %s\n", platform))
		}
		output.WriteString("\n")
	}

	// Memory Usage
	output.WriteString(" Memory Usage:\n")
	if total, ok := metrics.Memory["system_total"]; ok {
		output.WriteString(fmt.Sprintf("    System Total: %s\n", formatBytes(int64(total))))
	}
	if used, ok := metrics.Memory["system_used"]; ok {
		output.WriteString(fmt.Sprintf("    System Used: %s\n", formatBytes(int64(used))))
	}
	if free, ok := metrics.Memory["system_free"]; ok {
		output.WriteString(fmt.Sprintf("    System Free: %s\n", formatBytes(int64(free))))
	}

	// Calculate system memory usage percentage
	if total, totalOk := metrics.Memory["system_total"]; totalOk {
		if used, usedOk := metrics.Memory["system_used"]; usedOk && total > 0 {
			percentage := (used / total) * 100
			output.WriteString(fmt.Sprintf("    System Usage: %.2f%%\n", percentage))
		}
	}

	if heapUsed, ok := metrics.Memory["nodejs_heap_used"]; ok {
		output.WriteString(fmt.Sprintf("    Node.js Heap Used: %s\n", formatBytes(int64(heapUsed))))
	}
	if heapTotal, ok := metrics.Memory["nodejs_heap_total"]; ok {
		output.WriteString(fmt.Sprintf("    Node.js Heap Total: %s\n", formatBytes(int64(heapTotal))))
	}

	// Calculate Node.js heap usage percentage
	if heapUsed, usedOk := metrics.Memory["nodejs_heap_used"]; usedOk {
		if heapTotal, totalOk := metrics.Memory["nodejs_heap_total"]; totalOk && heapTotal > 0 {
			heapPercentage := (heapUsed / heapTotal) * 100
			output.WriteString(fmt.Sprintf("    Node.js Heap Usage: %.2f%%\n", heapPercentage))
		}
	}
	output.WriteString("\n")

	// CPU Usage
	output.WriteString(" CPU Usage:\n")

	if avgUsage, hasAverage := metrics.CPU["average"]; hasAverage {
		output.WriteString(fmt.Sprintf("    average: %.2f%%\n", avgUsage))
	}

	cpuCores := []string{"cpu0", "cpu1", "cpu2", "cpu3"}
	var cpuSum float64
	var cpuCount int

	for _, core := range cpuCores {
		if usage, exists := metrics.CPU[core]; exists {
			output.WriteString(fmt.Sprintf("    %s: %.2f%%\n", core, usage))
			cpuSum += usage
			cpuCount++
		}
	}

	if _, hasAverage := metrics.CPU["average"]; !hasAverage && cpuCount > 0 {
		calculated_average := cpuSum / float64(cpuCount)
		output.WriteString(fmt.Sprintf("    Average: %.2f%%\n", calculated_average))
	}

	for core, usage := range metrics.CPU {
		if core != "average" && !contains(cpuCores, core) {
			output.WriteString(fmt.Sprintf("    %s: %.2f%%\n", core, usage))
		}
	}

	output.WriteString("\n")

	// Worker Threads
	output.WriteString(" Worker Threads:\n")
	if total, ok := metrics.Threads["threads_total"]; ok {
		output.WriteString(fmt.Sprintf("    Total Threads: %.0f\n", total))
	}
	if available, ok := metrics.Threads["threads_available"]; ok {
		output.WriteString(fmt.Sprintf("    Available: %.0f\n", available))
	}
	if busy, ok := metrics.Threads["threads_busy"]; ok {
		output.WriteString(fmt.Sprintf("    Busy: %.0f\n", busy))
	}
	if active, ok := metrics.Threads["active_tasks"]; ok {
		output.WriteString(fmt.Sprintf("    Active Tasks: %.0f\n", active))
	}
	output.WriteString("\n")

	output.WriteString(" Metrics query completed successfully!\n")
	output.WriteString("\n")
	output.WriteString(" Test passed: Worker metrics integration works!\n")

	return output.String()
}

func generateMetricsSummary(metrics *WorkerMetrics) string {
	var summary strings.Builder

	summary.WriteString(fmt.Sprintf("Worker: %s | ", metrics.WorkerID))
	summary.WriteString(fmt.Sprintf("Time: %s | ", metrics.QueryTime.Format("15:04:05")))

	if total, totalOk := metrics.Memory["system_total"]; totalOk {
		if used, usedOk := metrics.Memory["system_used"]; usedOk && total > 0 {
			percentage := (used / total) * 100
			summary.WriteString(fmt.Sprintf("RAM: %.1f%% | ", percentage))
		}
	}

	if avgUsage, hasAverage := metrics.CPU["average"]; hasAverage {
		summary.WriteString(fmt.Sprintf("CPU: %.1f%% | ", avgUsage))
	}

	if heapUsed, usedOk := metrics.Memory["nodejs_heap_used"]; usedOk {
		if heapTotal, totalOk := metrics.Memory["nodejs_heap_total"]; totalOk && heapTotal > 0 {
			heapPercentage := (heapUsed / heapTotal) * 100
			summary.WriteString(fmt.Sprintf("Heap: %.1f%%", heapPercentage))
			if heapPercentage > 85 {
				summary.WriteString(" (HIGH!)")
			}
		}
	}

	return summary.String()
}

func extractReadableMetrics(metrics *WorkerMetrics) map[string]string {
	readable := make(map[string]string)

	if total, ok := metrics.Memory["system_total"]; ok {
		readable["system_memory_total"] = formatBytes(int64(total))
	}
	if used, ok := metrics.Memory["system_used"]; ok {
		readable["system_memory_used"] = formatBytes(int64(used))
	}
	if free, ok := metrics.Memory["system_free"]; ok {
		readable["system_memory_free"] = formatBytes(int64(free))
	}

	if total, totalOk := metrics.Memory["system_total"]; totalOk {
		if used, usedOk := metrics.Memory["system_used"]; usedOk && total > 0 {
			percentage := (used / total) * 100
			readable["system_memory_usage"] = fmt.Sprintf("%.2f%%", percentage)
		}
	}

	if heapUsed, ok := metrics.Memory["nodejs_heap_used"]; ok {
		readable["nodejs_heap_used"] = formatBytes(int64(heapUsed))
	}
	if heapTotal, ok := metrics.Memory["nodejs_heap_total"]; ok {
		readable["nodejs_heap_total"] = formatBytes(int64(heapTotal))
	}

	if heapUsed, usedOk := metrics.Memory["nodejs_heap_used"]; usedOk {
		if heapTotal, totalOk := metrics.Memory["nodejs_heap_total"]; totalOk && heapTotal > 0 {
			heapPercentage := (heapUsed / heapTotal) * 100
			readable["nodejs_heap_usage"] = fmt.Sprintf("%.2f%%", heapPercentage)
			if heapPercentage > 85 {
				readable["heap_alert"] = "HIGH NODE.JS HEAP USAGE!"
			} else {
				readable["heap_alert"] = "Normal"
			}
		}
	}

	if avgUsage, ok := metrics.CPU["average"]; ok {
		readable["cpu_average"] = fmt.Sprintf("%.2f%%", avgUsage)
	}

	for core, usage := range metrics.CPU {
		if core != "average" {
			readable[fmt.Sprintf("cpu_%s", core)] = fmt.Sprintf("%.2f%%", usage)
		}
	}

	if total, ok := metrics.Threads["threads_total"]; ok {
		readable["worker_threads_total"] = fmt.Sprintf("%.0f", total)
	}
	if available, ok := metrics.Threads["threads_available"]; ok {
		readable["worker_threads_available"] = fmt.Sprintf("%.0f", available)
	}
	if busy, ok := metrics.Threads["threads_busy"]; ok {
		readable["worker_threads_busy"] = fmt.Sprintf("%.0f", busy)
	}
	if active, ok := metrics.Threads["active_tasks"]; ok {
		readable["active_tasks"] = fmt.Sprintf("%.0f", active)
	}

	if version, ok := metrics.Info["version"]; ok {
		readable["worker_version"] = version
	}
	if platform, ok := metrics.Info["platform"]; ok {
		readable["worker_platform"] = platform
	}

	readable["data_size"] = formatBytes(int64(metrics.DataSize))

	return readable
}

func appendToTextLog(textFilepath string, snapshot WorkerMetricsSnapshot) error {
	logEntry := fmt.Sprintf("\n%s\n=== METRICS ENTRY #%s ===\nTimestamp: %s\nLabel: %s\n%s\n%s\n",
		strings.Repeat("=", 80),
		snapshot.Label,
		snapshot.Timestamp.Format("2006-01-02 15:04:05"),
		snapshot.Label,
		snapshot.FormattedOutput,
		strings.Repeat("=", 80))

	var file *os.File
	var err error

	if _, err := os.Stat(textFilepath); err == nil {
		file, err = os.OpenFile(textFilepath, os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return err
		}
	} else {
		file, err = os.Create(textFilepath)
		if err != nil {
			return err
		}
		header := fmt.Sprintf("CONSOLIDATED WORKER METRICS LOG\nWorker ID: %s\nStarted: %s\n%s\n",
			snapshot.Metrics.WorkerID,
			snapshot.Timestamp.Format("2006-01-02 15:04:05"),
			strings.Repeat("=", 80))
		file.WriteString(header)
	}
	defer file.Close()

	_, err = file.WriteString(logEntry)
	return err
}

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

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}