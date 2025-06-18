package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// Global raw configuration data.
var (
	// Global slices holding available and attached workers.
	availableWorkers []SSHConfig
	attachedWorkers  []SSHConfig
)

// init automatically initializes worker configurations on package load.
func init() {
	initWorkers(NDM_WORKERS_HOST, NDM_WORKERS_PORT, NDM_WORKERS_PASSWORD, NDM_WORKERS_USER_NAME)
}

// initWorkers parses the comma‑separated strings for IPs, ports, passwords, and usernames,
// and builds the availableWorkers slice.
func initWorkers(ips, ports, passwords, usernames string) {
	// Parse and trim IP addresses.
	ipList := []string{}
	for _, ip := range strings.Split(ips, ",") {
		tip := strings.TrimSpace(ip)
		if tip != "" {
			ipList = append(ipList, tip)
		}
	}

	// Parse ports.
	portListRaw := []string{}
	for _, port := range strings.Split(ports, ",") {
		tp := strings.TrimSpace(port)
		if tp != "" {
			portListRaw = append(portListRaw, tp)
		}
	}
	// Convert ports to ints.
	portList := []int{}
	for _, pStr := range portListRaw {
		p, err := strconv.Atoi(pStr)
		if err != nil {
			LogFatalf("Invalid port value: %s", pStr)
		}
		portList = append(portList, p)
	}
	// If only one port is provided, replicate it for all IPs.
	if len(portList) == 1 && len(ipList) > 1 {
		v := portList[0]
		for i := 1; i < len(ipList); i++ {
			portList = append(portList, v)
		}
	}

	// Parse passwords.
	passList := []string{}
	for _, pass := range strings.Split(passwords, ",") {
		tp := strings.TrimSpace(pass)
		if tp != "" {
			passList = append(passList, tp)
		}
	}
	// If only one password is provided, replicate it for all IPs.
	if len(passList) == 1 && len(ipList) > 1 {
		v := passList[0]
		for i := 1; i < len(ipList); i++ {
			passList = append(passList, v)
		}
	}

	// Parse usernames.
	usernameList := []string{}
	for _, user := range strings.Split(usernames, ",") {
		tu := strings.TrimSpace(user)
		if tu != "" {
			usernameList = append(usernameList, tu)
		}
	}
	// If only one username is provided, replicate it for all IPs.
	if len(usernameList) == 1 && len(ipList) > 1 {
		v := usernameList[0]
		for i := 1; i < len(ipList); i++ {
			usernameList = append(usernameList, v)
		}
	}

	// Ensure we have enough ports, passwords and usernames.
	if len(portList) < len(ipList) {
		LogFatalf("Insufficient number of ports provided. Got %d ports for %d IPs", len(portList), len(ipList))
	}
	if len(passList) < len(ipList) {
		LogFatalf("Insufficient number of passwords provided. Got %d passwords for %d IPs", len(passList), len(ipList))
	}
	if len(usernameList) < len(ipList) {
		LogFatalf("Insufficient number of usernames provided. Got %d usernames for %d IPs", len(usernameList), len(ipList))
	}

	// Build the availableWorkers slice.
	availableWorkers = []SSHConfig{}
	for i, ip := range ipList {
		worker := SSHConfig{
			Username: usernameList[i],
			Host:     ip,
			Port:     portList[i],
			Password: passList[i],
		}
		availableWorkers = append(availableWorkers, worker)
	}
	attachedWorkers = []SSHConfig{} // start with none attached
}

// getAvailableWorkersCount returns the total count of available workers.
func getAvailableWorkersCount() int {
	return len(availableWorkers)
}

// getAttachedWorkerCount returns the current count of attached workers.
func getAttachedWorkerCount() int {
	return len(attachedWorkers)
}

// containsWorker checks if a worker (by Host) is in the given slice.
func containsWorker(list []SSHConfig, item SSHConfig) bool {
	for _, v := range list {
		if v.Host == item.Host {
			return true
		}
	}
	return false
}

// AttachWorkers attaches the specified number of workers.
// A worker is considered attached only if the API call and SSH registration script succeed.
// On success, it returns a slice of worker IDs.
func AttachWorkers(count int, authToken, accountId, projectId string) ([]string, error) {
	if count > getAvailableWorkersCount() {
		return nil, errors.New("requested count exceeds total available workers")
	}

	current := getAttachedWorkerCount()
	if current > count {
		return nil, errors.New("already attached more workers than requested; please detach first")
	}

	needed := count - current
	var attachedWorkerIDs []string

	// Iterate over availableWorkers and for each not already attached, attempt to attach.
	for _, worker := range availableWorkers {
		if needed == 0 {
			break
		}
		if containsWorker(attachedWorkers, worker) {
			continue
		}
		// Try to register this worker.
		workerId, err := attachWorkerForConfig(worker, authToken, accountId, projectId)
		if err != nil {
			return nil, fmt.Errorf("failed to attach worker %s: %w", worker.Host, err)
		}
		LogDebug(fmt.Sprintf("Successfully registered worker %s with workerId: %s", worker.Host, workerId))
		attachedWorkers = append(attachedWorkers, worker)
		attachedWorkerIDs = append(attachedWorkerIDs, workerId)
		needed--
	}
	if getAttachedWorkerCount() != count {
		return nil, errors.New("failed to attach the required number of workers")
	}
	return attachedWorkerIDs, nil
}

// DetachWorkers detaches all attached workers by running the SSH detach script on each worker.
// If a count is provided, it detaches that many workers from the start of the attachedWorkers slice.
func DetachWorkers(count ...int) (string, error) {
	var outputBuilder strings.Builder
	var workersToDetach []SSHConfig
	var detachErrors []string

	// Determine how many workers to detach.
	if len(count) == 0 {
		// No arguments, so detach all workers.
		workersToDetach = attachedWorkers
		attachedWorkers = []SSHConfig{}
	} else {
		// Use the first integer argument as the number of workers to detach.
		numToDetach := count[0]
		if len(attachedWorkers) < numToDetach {
			return "", fmt.Errorf("requested to detach %d worker(s) but only %d attached", numToDetach, len(attachedWorkers))
		}
		workersToDetach = attachedWorkers[:numToDetach]
		// Remove the detached workers from attachedWorkers.
		attachedWorkers = attachedWorkers[numToDetach:]
	}

	// Detach each selected worker.
	for _, worker := range workersToDetach {
		output, err := DetachWorker(worker)
		if err != nil {
			msg := fmt.Sprintf("Failed to detach worker %s: %v", worker.Host, err)
			LogError(msg, err)
			outputBuilder.WriteString(msg + "\n")
			detachErrors = append(detachErrors, msg)
		} else {
			msg := fmt.Sprintf("Successfully detached worker %s with output: %s", worker.Host, output)
			LogDebug(msg)
			outputBuilder.WriteString(msg + "\n")
		}
	}

	if len(detachErrors) > 0 {
		return outputBuilder.String(), errors.New(strings.Join(detachErrors, "; "))
	}
	return outputBuilder.String(), nil
}

// CreateWorkerScript creates a shell script to register a worker using API response data.
func CreateWorkerScript(resp *http.Response) (string, string, error) {
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		LogError(fmt.Sprintf("Error reading response body: %v", err), err)
		return "", "", err
	}
	// WorkerResponse represents the expected API response.
	type WorkerResponse struct {
		WorkerId       string `json:"workerId"`
		WorkerSecret   string `json:"workerSecret"`
		ControlPlaneIp string `json:"controlPlaneIp"`
	}
	var workerResp WorkerResponse
	err = json.Unmarshal(respBody, &workerResp)
	if err != nil {
		return "", "", fmt.Errorf("error parsing response: %w", err)
	}
	script := fmt.Sprintf(`
	sudo su -c '
	export WORKER_ID=%s
	export WORKER_SECRET=%s
	export CONTROL_PLANE_IP=%s
	sh /opt/datamigrator/bin/worker_register.sh
	'
	`, workerResp.WorkerId, workerResp.WorkerSecret, workerResp.ControlPlaneIp)
	return script, workerResp.WorkerId, nil
}

// GetDetachWorkerScript generates a shell script to stop/disable and remove worker environment variables.
func GetDetachWorkerScript() string {
	script := fmt.Sprintf(`#!/bin/bash
	set -e 

	SUDO_PASS="%s"

	SERVICE="datamigrator-worker.service"
	ENV_FILE="/opt/datamigrator/conf/worker.env"

	if systemctl is-active --quiet "$SERVICE"; then
		echo "Service $SERVICE is active. Stopping and disabling..."
		echo "$SUDO_PASS" | sudo -S systemctl stop "$SERVICE"
		echo "$SUDO_PASS" | sudo -S systemctl disable "$SERVICE"
	else
		echo "Service $SERVICE is not active. Skipping stop/disable."
	fi

	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_CONFIG_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_JOB_SERVICE_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_REPORT_SERVICE_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^TEMPORAL_ADDRESS=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^KEYCLOAK_BASE_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_ID=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_SECRET=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^FLUENT_HOST=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_HOST=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_USERNAME=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_PASSWORD=/d' "$ENV_FILE"

	echo "Successfully disabled worker service"
	`, NDM_VM_PASSWORD)
	return script
}

// DetachWorker runs the detach script on a given worker via SSH.
func DetachWorker(config SSHConfig) (string, error) {
	script := GetDetachWorkerScript()
	return sshRunScript(config, script)
}

// attachWorkerForConfig registers a single worker via API call and SSH.
// It returns the workerId if successful.
func attachWorkerForConfig(worker SSHConfig, authToken, accountId, projectId string) (string, error) {
	fullURL := CONFIG_SERVICE_URL + "/api/v1/worker-registration"
	data := map[string]string{
		"projectId": projectId,
	}
	reqBody, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("POST", fullURL, reqBody, headers)
	if err != nil {
		return "", err
	}
	script, workerId, err := CreateWorkerScript(resp)
	if err != nil {
		return workerId, err
	}
	LogDebug(fmt.Sprintf("For worker %s, running script: %s", worker.Host, script))
	output, err := sshRunScript(worker, script)
	if err != nil {
		return workerId, err
	}
	LogDebug(fmt.Sprintf("Output from worker %s: %s", worker.Host, output))
	return workerId, nil
}
