package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// Global raw configuration data.
var (
	// Global slices holding available and attached workers.
	EnvWorkersConfigList  []SSHConfig
	AttachedWorkersConfig map[string]SSHConfig
)

type AttachWorkerResult struct {
	workerConfig SSHConfig
	workerId     string
	err          error
}

type DetachWorkerResult struct {
	workerConfig SSHConfig
	workerID     string
	output       string
	err          error
}

// InitWorkers parses the comma‑separated strings for IPs, ports, passwords, and usernames,
// and builds the EnvWorkersConfigList slice.
func InitWorkers(ips, ports, passwords, usernames string) {
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

	// Build the EnvWorkersConfigList slice.
	EnvWorkersConfigList = []SSHConfig{}
	for i, ip := range ipList {
		worker := SSHConfig{
			Username: usernameList[i],
			Host:     ip,
			Port:     portList[i],
			Password: passList[i],
		}
		EnvWorkersConfigList = append(EnvWorkersConfigList, worker)
	}

	LogDebug(fmt.Sprintf("Workers ssh config loaded from .env : %+v", strings.Join(ipList, ",")))
	LogDebug(fmt.Sprintf("Worker count: %d", len(EnvWorkersConfigList)))
	AttachedWorkersConfig = make(map[string]SSHConfig)
}

// getEnvWorkersConfigListCount returns the total count of available workers.
func getEnvWorkersConfigListCount() int {
	return len(EnvWorkersConfigList)
}

// getAttachedWorkerCount returns the current count of attached workers.
func getAttachedWorkerCount() int {
	return len(AttachedWorkersConfig)
}

// containsWorker checks if a worker (by Host) is in the given slice.
func containsWorker(AttachedWorkersConfig map[string]SSHConfig, item SSHConfig) bool {
	for _, v := range AttachedWorkersConfig {
		if v.Host == item.Host {
			return true
		}
	}
	return false
}

// AttachWorkers attaches the specified number of workers.
// A worker is considered attached only if the API call and SSH registration script succeed.
// On success, it returns a map of worker IDs to their SSH configurations.
func AttachWorkers(count int, authToken, accountId, projectId string) (map[string]SSHConfig, error) {
	if count > getEnvWorkersConfigListCount() {
		return nil, errors.New("requested count exceeds total available workers")
	}

	current := getAttachedWorkerCount()
	if current > count {
		return nil, errors.New("already attached more workers than requested; please detach first")
	}

	var wg sync.WaitGroup
	attachWorkerRes := make(chan AttachWorkerResult, len(EnvWorkersConfigList))

	needed := count

	// Iterate over EnvWorkersConfigList and for each not already attached, attempt to attach.
	for _, workerConfig := range EnvWorkersConfigList {
		if needed == 0 {
			break
		}

		if containsWorker(AttachedWorkersConfig, workerConfig) {
			continue
		}

		wg.Add(1)
		// Try to register this worker.
		go attachWorkerForConfig(workerConfig, authToken, accountId, projectId, attachWorkerRes, &wg)
		needed--
	}

	go func() {
		wg.Wait()
		close(attachWorkerRes)
	}()

	for res := range attachWorkerRes {
		if res.err != nil {
			return nil, fmt.Errorf("failed to attach worker %s: %w", res.workerConfig.Host, res.err)
		}
		LogDebug(fmt.Sprintf("Successfully registered worker %s with workerId: %s", res.workerConfig.Host, res.workerId))
		AttachedWorkersConfig[res.workerId] = res.workerConfig
	}

	if getAttachedWorkerCount() != count {
		return nil, fmt.Errorf("failed to attach the required number of workers , attachedCount : %d , needed : %d", getAttachedWorkerCount(), count)
	}
	LogDebug(fmt.Sprintf("Total Worker Attached : %d", len(AttachedWorkersConfig)))
	return AttachedWorkersConfig, nil
}

// GetAttachedWorkersConfig returns the current map of attached workers.
func GetAttachedWorkersConfig() map[string]SSHConfig {
	return AttachedWorkersConfig
}

func GetAttachedWorkerDetails() SSHConfig {
	// Maintain order from EnvWorkersConfigList (preserves .env file order)
	// This ensures we always return the first worker consistently
	for _, workerConfig := range EnvWorkersConfigList {
		for _, attachedConfig := range AttachedWorkersConfig {
			if attachedConfig.Host == workerConfig.Host {
				return attachedConfig
			}
		}
	}
	// Fallback: return empty SSHConfig if no workers attached
	return SSHConfig{}
}

// DetachWorkers detaches all attached workers by running the SSH detach script on each worker.
// If a count is provided, it detaches that many workers from the start of the attachedWorkers slice.
func DetachWorkers(workerIdsToDelete []string) error {
	var detachErrors []string

	// Detach the specified worker by ID.
	if len(workerIdsToDelete) == 0 {
		return errors.New("no worker ID provided for detachment")
	}

	var wg sync.WaitGroup
	detachWorkerRes := make(chan DetachWorkerResult, len(workerIdsToDelete))

	for workerId, workerConfig := range AttachedWorkersConfig {
		for _, workerIdToDelete := range workerIdsToDelete {
			if workerId == workerIdToDelete {
				wg.Add(1)
				go DetachWorker(workerConfig, workerId, detachWorkerRes, &wg)
			}
		}
	}

	go func() {
		wg.Wait()
		close(detachWorkerRes)
	}()

	for res := range detachWorkerRes {
		if res.err != nil {
			msg := fmt.Sprintf("Failed to detach worker %s: %v", res.workerConfig.Host, res.err)
			LogError(msg, res.err)
			detachErrors = append(detachErrors, msg)
		} else {
			msg := fmt.Sprintf("Successfully detached worker %s with output: %s", res.workerConfig.Host, res.output)
			// Remove the worker from the AttachedWorkersConfig map.
			delete(AttachedWorkersConfig, res.workerID)
			LogDebug(msg)
		}
	}

	if len(detachErrors) > 0 {
		return errors.New(strings.Join(detachErrors, "; "))
	}
	return nil
}

// DetachAllWorkers detaches all currently attached workers.
func DetachAllWorkers() error {
	if len(AttachedWorkersConfig) == 0 {
		return errors.New("no workers currently attached")
	}

	// Collect all worker IDs to delete.
	workerIdsToDelete := make([]string, 0, len(AttachedWorkersConfig))
	for workerId := range AttachedWorkersConfig {
		workerIdsToDelete = append(workerIdsToDelete, workerId)
	}

	// Detach the workers.
	return DetachWorkers(workerIdsToDelete)
}

// CreateWorkerScript creates a shell script to register a worker using API response data.
func CreateWorkerScript(resp *http.Response, projectId string) (string, string, error) {
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		LogError(fmt.Sprintf("Error reading response body: %v", err), err)
		return "", "", err
	}
	type WorkerItems struct {
		WorkerId       string `json:"workerId"`
		WorkerSecret   string `json:"workerSecret"`
		ControlPlaneIp string `json:"controlPlaneIp"`
	}
	type WorkerData struct {
		Items WorkerItems `json:"items"`
	}
	type WorkerResponse struct {
		TrackId string     `json:"trackId"`
		Message string     `json:"message"`
		Data    WorkerData `json:"data"`
	}

	var workerResp WorkerResponse
	err = json.Unmarshal(respBody, &workerResp)
	if err != nil {
		return "", "", fmt.Errorf("error parsing response: %w", err)
	}

	workerId := workerResp.Data.Items.WorkerId
	workerSecret := workerResp.Data.Items.WorkerSecret
	controlPlaneIp := workerResp.Data.Items.ControlPlaneIp

	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		script = fmt.Sprintf(`
    sudo su -c '
    export WORKER_ID=%s
    export WORKER_SECRET=%s
	export PROJECT_ID=%s
    export CONTROL_PLANE_IP=%s
    sh /opt/datamigrator/bin/worker_register.sh
    '
    `, workerId, workerSecret, projectId, controlPlaneIp)

	case ProtocolSMB:
		script = fmt.Sprintf(
			`"%s" /SILENT /WORKERID=%s /WORKERSECRET=%s /CONTROLPLANEIP=%s /PROJECTID=%s`,
			SMB_EXECUTABLE_FILENAME,
			workerId,
			workerSecret,
			controlPlaneIp,
			projectId,
		)
	}

	return script, workerId, nil
}

func GetDetachWorkerScriptForSMB() string {
	psScript := `Start-Process -Wait -FilePath "C:\datamigrator\unins000.exe" -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/LOG=C:\datamigrator_uninstall.log"; if (Test-Path "C:\datamigrator") { Remove-Item -Path "C:\datamigrator" -Recurse -Force }`

	return fmt.Sprintf(`powershell.exe -Command "%s"`, psScript)
}

// GetDetachWorkerScriptForNFS generates a shell script to stop/disable and remove worker environment variables.
func GetDetachWorkerScriptForNFS(workerConfig SSHConfig) string {
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
	echo "$SUDO_PASS" | sudo -S sed -i '/^CONTROL_PLANE_IP=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_HOST=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_USERNAME=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_PASSWORD=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^PROJECT_ID=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^OTEL_COLLECTOR_ENDPOINT=/d' "$ENV_FILE"


	echo "Successfully disabled worker service"
	`, workerConfig.Password)
	return script
}

// DetachWorker runs the detach script on a given worker via SSH.
func DetachWorker(workerConfig SSHConfig, workerID string, detachWorkerRes chan DetachWorkerResult, wg *sync.WaitGroup) {
	defer wg.Done()
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		script = GetDetachWorkerScriptForNFS(workerConfig)
	case ProtocolSMB:
		script = GetDetachWorkerScriptForSMB()
	}

	LogDebug(fmt.Sprintf("Detaching Worker %s and running script: \n%s", workerConfig.Host, script))
	output, err := sshRunScript(workerConfig, script)
	detachWorkerRes <- DetachWorkerResult{workerConfig, workerID, output, err}
}

// StartWorker starts the worker service on a given worker via SSH.
func StartWorker(config SSHConfig) (string, error) {
	script := GetStartWorkerScript()
	output, err := sshRunScript(config, script)
	if err != nil {
		return "", fmt.Errorf("failed to start worker on %s: %w", config.Host, err)
	}
	LogDebug(fmt.Sprintf("Worker %s started successfully with output: %s", config.Host, output))
	return output, nil
}

// RestartWorker starts the worker service on a given worker via SSH.
func RestartWorker(config SSHConfig) (string, error) {
	script := GetRestartWorkerScript()
	output, err := sshRunScript(config, script)
	if err != nil {
		return "", fmt.Errorf("failed to start worker on %s: %w", config.Host, err)
	}
	LogDebug(fmt.Sprintf("Worker %s restarted successfully with output: %s", config.Host, output))
	return output, nil
}

// StopWorker stops the worker service on a given worker via SSH.
func StopWorker(config SSHConfig) (string, error) {
	script := GetStopWorkerScript()
	output, err := sshRunScript(config, script)
	if err != nil {
		return "", fmt.Errorf("failed to stop worker on %s: %w", config.Host, err)
	}
	LogDebug(fmt.Sprintf("Worker %s stopped successfully with output: %s", config.Host, output))
	return output, nil
}

// StopAllWorkersAndWait stops all the worker service
func StopAllWorkersAndWait() error {
	if len(AttachedWorkersConfig) == 0 {
		return fmt.Errorf("no workers are attached to stop")
	}

	for _, workerConfig := range AttachedWorkersConfig {
		_, err := StopWorker(workerConfig)
		if err != nil {
			return fmt.Errorf("error stopping worker, %s, err = %s", workerConfig.Host, err.Error())
		}
	}

	Wait(10)
	return nil
}

func attachWorkerForConfig(workerConfig SSHConfig, authToken, accountId, projectId string, attachWorkerRes chan AttachWorkerResult, wg *sync.WaitGroup) {
	defer wg.Done()

	fullURL := CONFIG_SERVICE_URL + "/api/v1/worker-registration"
	data := map[string]string{
		"projectId": projectId,
	}
	reqBody, err := json.Marshal(data)
	if err != nil {
		attachWorkerRes <- AttachWorkerResult{workerConfig, "", err}
		return
	}
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("POST", fullURL, reqBody, headers)
	if err != nil {
		attachWorkerRes <- AttachWorkerResult{workerConfig, "", err}
		return
	}
	script, workerId, err := CreateWorkerScript(resp, projectId)
	if err != nil {
		attachWorkerRes <- AttachWorkerResult{workerConfig, workerId, err}
		return
	}

	// First, clean up any existing worker registration
	var cleanupScript string
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		cleanupScript = GetDetachWorkerScriptForNFS(workerConfig)
	case ProtocolSMB:
		cleanupScript = GetDetachWorkerScriptForSMB()
	}
	LogDebug(fmt.Sprintf("Cleaning up existing worker registration on %s", workerConfig.Host))
	_, _ = sshRunScript(workerConfig, cleanupScript) // Ignore errors if worker wasn't registered

	// Now register the worker
	LogDebug(fmt.Sprintf("Attaching Worker %s and running script: \n%s", workerConfig.Host, script))
	_, err = sshRunScript(workerConfig, script)
	if err != nil {
		attachWorkerRes <- AttachWorkerResult{workerConfig, workerId, err}
		return
	}
	attachWorkerRes <- AttachWorkerResult{workerConfig, workerId, nil}
}

// GetWorkerIds returns a slice of worker IDs from the AttachedWorkersConfig map.
func GetWorkerIds() []string {
	workerIds := make([]string, 0, len(AttachedWorkersConfig))

	// Iterate over the AttachedWorkersConfig map and collect worker IDs.
	if len(AttachedWorkersConfig) == 0 {
		return workerIds // Return empty slice if no workers are attached.
	}

	// Maintain order from EnvWorkersConfigList (preserves .env file order)
	// This ensures consistent worker selection for tests that use workerIds[0]
	for _, workerConfig := range EnvWorkersConfigList {
		for workerId, attachedConfig := range AttachedWorkersConfig {
			if attachedConfig.Host == workerConfig.Host {
				workerIds = append(workerIds, workerId)
				break
			}
		}
	}
	return workerIds
}

func getStopWorkerScriptForNFS() string {
	return fmt.Sprintf(`#!/bin/bash
	set -e 

	SUDO_PASS="%s"

	SERVICE="datamigrator-worker.service"

	if systemctl is-active --quiet "$SERVICE"; then
		echo "Service $SERVICE is active. Stopping and disabling..."
		echo "$SUDO_PASS" | sudo -S systemctl stop "$SERVICE"
	else
		echo "Service $SERVICE is not active. Skipping stop/disable."
	fi

	echo "Successfully stopped worker service"
	`, NDM_VM_PASSWORD)
}

func getStopWorkerScriptForSMB() string {
	return `cmd /C net stop "Datamigrator Worker"`
}

// GetStopWorkerScript generates a shell script to stop worker service.
func GetStopWorkerScript() string {
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		return getStopWorkerScriptForNFS()
	case ProtocolSMB:
		return getStopWorkerScriptForSMB()
	}
	return ""
}

func getStartWorkerScriptForNFS() string {
	return fmt.Sprintf(`#!/bin/bash
	set -e 

	SUDO_PASS="%s"

	SERVICE="datamigrator-worker.service"

	if ! systemctl is-active --quiet "$SERVICE"; then
		echo "Service $SERVICE is not active. Starting..."
		echo "$SUDO_PASS" | sudo -S systemctl start "$SERVICE"
	else
		echo "Service $SERVICE is already active. Skipping start."
	fi

	echo "Successfully started worker service"
	`, NDM_VM_PASSWORD)
}

func getStartWorkerScriptForSMB() string {
	return `cmd /C net start "Datamigrator Worker"`
}

// GetStopWorkerScript generates a shell script to start worker service.
func GetStartWorkerScript() string {
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		return getStartWorkerScriptForNFS()
	case ProtocolSMB:
		return getStartWorkerScriptForSMB()
	}
	return ""
}

// GetRestartWorkerScript generates a shell script to restart worker service.
func GetRestartWorkerScript() string {
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		return getRestartWorkerScriptForNFS()
	case ProtocolSMB:
		return getRestartWorkerScriptForSMB()
	}
	return ""
}

func getRestartWorkerScriptForSMB() string {
	// Use error suppression (2>nul) for stop command in case service is already stopped
	return `cmd /C "net stop "Datamigrator Worker" 2>nul & net start "Datamigrator Worker""`
}

func getRestartWorkerScriptForNFS() string {
	script := fmt.Sprintf(`#!/bin/bash
	set -e 

	SUDO_PASS="%s"

	SERVICE="datamigrator-worker.service"
	echo "$SUDO_PASS" | sudo -S systemctl restart "$SERVICE"

	`, NDM_VM_PASSWORD)
	return script
}

func UpdateWorkerEnvAndRestart(maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize int) error {
	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	var script string
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		script = WorkerEnvVarsScriptForNFS(sshConfig.Password, maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize)
	case ProtocolSMB:
		script = WorkerEnvVarsScriptForSMB(maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize)
	}

	_, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("failed to update worker config on %s: %w", sshConfig.Host, err)
	}

	LogDebug(fmt.Sprintf("Worker %s config successfully updated, MAX_WRITE_CONCURRENCY=%d, JOB_TASK_ACTIVITY_CONCURRENCY=%d, MAX_BUFFER_SIZE=%d",
		sshConfig.Host, maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize))

	_, err = RestartWorker(sshConfig)
	if err != nil {
		return fmt.Errorf("failed to restart worker, worker=%s, err=%v", sshConfig.Host, err)
	}
	return nil
}

// WorkerEnvVarsScriptForNFS generates a shell script to update specific env vars in worker.env.
func WorkerEnvVarsScriptForNFS(passwd string, maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize int) string {
	script := fmt.Sprintf(`
	#!/bin/bash
	set -e

	SUDO_PASS="%s"
	ENV_FILE="%s"

	echo "$SUDO_PASS" | sudo -S sed -i 's/^MAX_WRITE_CONCURRENCY=.*/MAX_WRITE_CONCURRENCY=%d/' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i 's/^JOB_TASK_ACTIVITY_CONCURRENCY=.*/JOB_TASK_ACTIVITY_CONCURRENCY=%d/' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i 's/^MAX_BUFFER_SIZE=.*/MAX_BUFFER_SIZE=%d/' "$ENV_FILE"

	echo "Updated MAX_WRITE_CONCURRENCY, JOB_TASK_ACTIVITY_CONCURRENCY, and MAX_BUFFER_SIZE in $ENV_FILE"
	`, passwd, NFSWorkerEnvPath, maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize)
	return script
}

// WorkerEnvVarsScriptForSMB generates a PowerShell script to update specific env vars in worker.env for SMB workers.
func WorkerEnvVarsScriptForSMB(maxWriteConcurrency, jobTaskActivityConcurrency, maxBufferSize int) string {
	script := fmt.Sprintf(`powershell.exe -Command "(Get-Content %s) -replace 'MAX_BUFFER_SIZE=\d+', 'MAX_BUFFER_SIZE=%d' -replace 'MAX_WRITE_CONCURRENCY=\d+', 'MAX_WRITE_CONCURRENCY=%d' -replace 'JOB_TASK_ACTIVITY_CONCURRENCY=\d+', 'JOB_TASK_ACTIVITY_CONCURRENCY=%d' | Set-Content %s"`, SMBWorkerEnvPath, maxBufferSize, maxWriteConcurrency, jobTaskActivityConcurrency, SMBWorkerEnvPath)
	return script
}

func IsWorkerRunning() (bool, error) {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		script = `systemctl status datamigrator-worker.service | grep 'Active'`
	case ProtocolSMB:
		script = `sc query "DatamigratorWorker" | find "STATE"`
	}

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return false, fmt.Errorf("GetWorkerStatus failed: %w\noutput: %s", err, output)
	}

	if strings.Contains(strings.ToLower(string(output)), "running") {
		LogDebug("Datamigrator Worker service is running.")
		return true, nil
	}

	LogDebug("Datamigrator Worker service is NOT running.")
	return false, nil
}

func GetMaxCPUUsageReport(jobid string) (string, error) {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		// Read the max CPU usage from the file created by the background monitoring script
		script = fmt.Sprintf(`powershell.exe -Command "Get-Content -Path 'C:\Temp\%s_max_cpu_usage.txt' -ErrorAction Stop"`, jobid)
	case ProtocolNFS:
		// Read from /tmp/ instead of /home/ubuntu/
		script = "cat /tmp/" + jobid + "_max_cpu_usage.txt"
	}

	// Use GetAttachedWorkerDetails() which properly handles comma-separated worker IPs
	config := GetAttachedWorkerDetails()

	output, err := sshRunScript(config, script)
	if err != nil {
		return "", fmt.Errorf("GetMaxCPUUsageReport failed: %w\noutput: %s", err, output)
	}

	// For both SMB and NFS, parse the output format: timestamp | jobid | cpu_usage%
	cpuUsageInfo := strings.Split(strings.TrimSpace(string(output)), "|")
	if len(cpuUsageInfo) < 3 {
		return "", fmt.Errorf("unexpected CPU usage format. Expected 'timestamp|jobid|cpu_usage', got: %s", string(output))
	}

	return strings.TrimSpace(cpuUsageInfo[2]), nil
}

func StopCPUMonitoring() error {
	var script string

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		// TODO - implement for SMB workers
		// script = `"powershell.exe -Command  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "smb_cpu_usage.ps1" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`
		return nil
	case ProtocolNFS:
		script = "sudo pkill -f nfs_cpu_usage.sh"
	}

	// Use GetAttachedWorkerDetails() which properly handles comma-separated worker IPs
	config := GetAttachedWorkerDetails()

	output, err := sshRunScript(config, script)
	if err != nil {
		return fmt.Errorf("StopCPUMonitoring failed: %w\noutput: %s", err, output)
	}

	return nil
}
