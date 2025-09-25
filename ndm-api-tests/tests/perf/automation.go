package main

import (
    "bufio"
    "bytes"
    "crypto/tls"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "io/ioutil"
    "log"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"

    . "ndm-api-tests/utils"

    "github.com/creack/pty"
)

// =============================================================================
// CORE TYPES AND STRUCTURES
// =============================================================================

type InfrastructureManager struct {
    runScript    string
    terraformDir string
}

type EndToEndMigration struct {
    // Infrastructure endpoints
    cpEndpoints     []string
    workerEndpoints []string

    // Migration components
    projectId             string
    workerId              []string
    sourceConfigId        string
    destinationConfigId   string
    sourcePathId          string
    destinationPathId     string
    discoveryJobConfigId  string
    destmountPath         string
    migrationJobConfigIds []string
    cutoverJobConfigIds   []string
    DestinationIP         string

    // Configuration
    headers               map[string]string
    attachedWorkersConfig map[string]SSHConfig

    // Volume paths
    sourceVolumePath      string
    destinationVolumePath string

    // Logging
    migrationLogs []string
    
}

type SourceConfig struct {
    Host       string
    Volume     string
    ConfigName string
}

type TerraformOutputs struct {
    ControlPlaneInstanceNames []string `json:"control_plane_instance_names"`
    ControlPlaneZones         []string `json:"control_plane_zones"`
}

// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

var availableWorkers []SSHConfig
var attachedWorkersConfig = make(map[string]SSHConfig)

// =============================================================================
// INFRASTRUCTURE MANAGEMENT
// =============================================================================

func (im *InfrastructureManager) RunScript() error {
    cmd := exec.Command("bash", im.runScript)
    cmd.Dir = im.terraformDir
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    err := cmd.Run()
    if err != nil {
        return fmt.Errorf("error running script: %v", err)
    }
    return nil
}

func (im *InfrastructureManager) GetOutputs() (map[string][]string, error) {
    cmd := exec.Command("terraform", "output", "-json")
    cmd.Dir = im.terraformDir

    output, err := cmd.Output()
    if err != nil {
        return nil, fmt.Errorf("failed to get terraform outputs: %v", err)
    }

    var rawOutputs map[string]interface{}
    if err := json.Unmarshal(output, &rawOutputs); err != nil {
        return nil, fmt.Errorf("failed to parse terraform outputs: %v", err)
    }

    result := make(map[string][]string)
    for key, value := range rawOutputs {
        if valMap, ok := value.(map[string]interface{}); ok {
            switch v := valMap["value"].(type) {
            case []interface{}:
                ips := []string{}
                for _, ip := range v {
                    ips = append(ips, fmt.Sprintf("%v", ip))
                }
                result[key] = ips
            case string:
                result[key] = []string{v}
            }
        }
    }
    return result, nil
}

// =============================================================================
// AUTHENTICATION AND SECURITY
// =============================================================================

func getOpenbaoHeaders(token string) map[string]string {
    return map[string]string{
        "Content-Type":  ContentTypeForm,
        "X-Vault-Token": token,
    }
}

func getOpenBaoRootToken() (string, error) {
    type ClusterKeys struct {
        RootToken string `json:"root_token"`
    }

    infraMgr := InfrastructureManager{
        terraformDir: "../../../app-deployment/terraform/gcp",
    }

    cmd := exec.Command("terraform", "output", "-json", "control_plane_instance_names")
    cmd.Dir = infraMgr.terraformDir
    output, err := cmd.Output()
    if err != nil {
        return "", fmt.Errorf("failed to get CP instance names: %w", err)
    }

    var instanceNames []string
    if err := json.Unmarshal(output, &instanceNames); err != nil {
        return "", fmt.Errorf("failed to parse instance names: %w", err)
    }

    cmd = exec.Command("terraform", "output", "-json", "control_plane_zones")
    cmd.Dir = infraMgr.terraformDir
    output, err = cmd.Output()
    if err != nil {
        return "", fmt.Errorf("failed to get CP zones: %w", err)
    }

    var zones []string
    if err := json.Unmarshal(output, &zones); err != nil {
        return "", fmt.Errorf("failed to parse zones: %w", err)
    }

    if len(instanceNames) == 0 || len(zones) == 0 {
        return "", fmt.Errorf("no control plane instances found")
    }

    // for perf run
    cpName := instanceNames[0]
    zone := zones[0]

    // for abhishek test
    // cpName:="cp-0809-build-0909-run-090949-abhi-valida-dk"
    // zone:="us-east1-b"

    // for shefali test
    // cpName:="cp-abhi-adhoc-shefa-dk"
    // zone:="us-east4-c"

    // performed with 10con to validate
    // cpName:="cp-0609-build-1709-run-121350-shef-con10"
    // zone:="us-east4-c"



    if cpName == "" {
        return "", fmt.Errorf("no control plane instance name found")
    }

    fmt.Printf("Connecting to CP instance: %s in zone: %s\n", cpName, zone)

    gcloudCmd := exec.Command("gcloud",
        "compute",
        "ssh",
        cpName,
        fmt.Sprintf("--zone=%s", zone),
        "--ssh-flag=-o PubkeyAcceptedKeyTypes=+ssh-rsa",
        "--command=cat /opt/datamigrator/openbao/cluster-keys.json",
    )

    clusterKeysOutput, err := gcloudCmd.Output()
    if err != nil {
        if exitErr, ok := err.(*exec.ExitError); ok {
            return "", fmt.Errorf("gcloud ssh command failed: %w, stderr: %s", err, exitErr.Stderr)
        }
        return "", fmt.Errorf("gcloud ssh command failed: %w", err)
    }

    var keys ClusterKeys
    if err := json.Unmarshal(clusterKeysOutput, &keys); err != nil {
        return "", fmt.Errorf("failed to parse cluster keys JSON: %w", err)
    }

    if keys.RootToken == "" {
        return "", fmt.Errorf("root token not found in JSON")
    }

    return keys.RootToken, nil
}

func getKeyCloakAdminCredentials() (KeycloakCredentials, error) {
    token, err := getOpenBaoRootToken()
    if err != nil {
        return KeycloakCredentials{}, fmt.Errorf("failed to get OpenBao root token: %w", err)
    }

    if KEYCLOAK_IP == "" {
        return KeycloakCredentials{}, fmt.Errorf("environment variable KEYCLOAK_IP not set")
    }

    fmt.Println("KEYCLOAK_IP:", KEYCLOAK_IP)
    fmt.Printf("KEYCLOAK_CREDENTIALS_URL: %s\n", KEYCLOAK_CREDENTIALS_URL)
    url := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, KEYCLOAK_CREDENTIALS_URL)
    headers := getOpenbaoHeaders(token)
    resp, err := SendAPIRequest("GET", url, nil, headers)
    if err != nil {
        return KeycloakCredentials{}, fmt.Errorf("failed to execute HTTP request: %w", err)
    }
    defer resp.Body.Close()
    fmt.Println(resp)
    bodyBytes, err := io.ReadAll(resp.Body)
    if err != nil {
        return KeycloakCredentials{}, fmt.Errorf("failed to read response body: %w", err)
    }

    type KeycloakResponse struct {
        Data struct {
            AdminUser     string `json:"KEYCLOAK_ADMIN_USER"`
            AdminPassword string `json:"KEYCLOAK_ADMIN_PASSWORD"`
            ClientSecret  string `json:"KEYCLOAK_CLIENT_SECRET"`
        } `json:"data"`
    }

    var kcResp KeycloakResponse
    err = json.Unmarshal(bodyBytes, &kcResp)
    if err != nil {
        return KeycloakCredentials{}, fmt.Errorf("failed to parse JSON response: %w", err)
    }

    if kcResp.Data.AdminUser == "" && kcResp.Data.AdminPassword == "" && kcResp.Data.ClientSecret == "" {
        return KeycloakCredentials{}, fmt.Errorf("keycloak credentials not found in response: %s", string(bodyBytes))
    }

    creds := KeycloakCredentials{
        AdminUser:     kcResp.Data.AdminUser,
        AdminPassword: kcResp.Data.AdminPassword,
        ClientSecret:  kcResp.Data.ClientSecret,
    }

    return creds, nil
}

func resetUserPassword(userID, accessToken, newPassword string) error {
    envPath := "../.env"
	
	if KEYCLOAK_IP == "" {
        return fmt.Errorf("environment variable KEYCLOAK_IP not set")
    }
    url := fmt.Sprintf("https://%s/%s/%s/reset-password", KEYCLOAK_IP, KEYCLOAK_BASE_URL, userID)

    var err error
    PASSWORD, err = GenerateNewPassword(10)
    if err != nil {
        return fmt.Errorf("failed to generate new password: %w", err)
    }
    fmt.Println("PASSWORD:", PASSWORD)
	LogDebug(fmt.Sprintf("Generated new password: %s", PASSWORD))
	// os.Setenv("PASSWORD", PASSWORD)

	updates := map[string]string{
        "PASSWORD": PASSWORD,
    }

	 if err := updateEnvVars(envPath, updates); err != nil {
        return fmt.Errorf("failed to update PASSWORD in .env file: %v", err)
    }

    // Also set in current process
    os.Setenv("PASSWORD", newPassword)

	fmt.Printf("✅ PASSWORD updated in .env file: %s\n", envPath)

    payload := map[string]interface{}{
        "type":      "password",
        "value":     PASSWORD,
        "temporary": false,
    }

    bodyBytes, err := json.Marshal(payload)
    if err != nil {
        return fmt.Errorf("failed to marshal payload: %w", err)
    }

    headers := GetHeaders(accessToken, ContentTypeJSON)
    resp, err := SendAPIRequest("PUT", url, bodyBytes, headers)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
        return fmt.Errorf("unexpected response code: %d", resp.StatusCode)
    }
    return nil
}

func updateAppAdmin(keycloakUser, keycloakPassword string) error {
    keycloakAuthToken, err := GetKeyCloakAccessToken(keycloakUser, keycloakPassword)
    if err != nil {
        return fmt.Errorf("error getting Keycloak access token: %v", err)
    }

    userID, err := FetchUserID(USERNAME, keycloakAuthToken)
    if err != nil {
        return fmt.Errorf("error fetching user ID for '%s': %v", USERNAME, err)
    }

    fmt.Println("USERNAME:", USERNAME)
    fmt.Println("USERID:", userID)

    err = resetUserPassword(userID, keycloakAuthToken, PASSWORD)
    if err != nil {
        return fmt.Errorf("error resetting password for '%s': %v", USERNAME, err)
    }

    err = UpdateUserProfile(userID, keycloakAuthToken)
    if err != nil {
        return fmt.Errorf("error updating profile for '%s': %v", USERNAME, err)
    }

    log.Printf("Successfully updated app admin for '%s'", USERNAME)
    return nil
}

func initTestEnv() {
    maxRetries := 30
    retryDelay := 60 * time.Second

    var creds KeycloakCredentials
    var keycloakErr error
    var tokenErr, roleIdsErr error

    for i := 0; i < maxRetries; i++ {
        creds, keycloakErr = getKeyCloakAdminCredentials()
        if keycloakErr == nil {
            break
        }

        if i < maxRetries-1 {
            LogDebug(fmt.Sprintf("Retry %d/%d: Getting Keycloak credentials failed: %v", i+1, maxRetries, keycloakErr))
            time.Sleep(retryDelay)
        }
    }

    if keycloakErr != nil {
        LogFatalf("Error getting Keycloak secrets after %d retries: %v", maxRetries, keycloakErr)
    }

    KeycloakUser = creds.AdminUser
    KeycloakPassword = creds.AdminPassword
    CLIENT_SECRET = creds.ClientSecret

    fmt.Println("KeycloakUser:", KeycloakUser)
    LogDebug(fmt.Sprintf("Keycloak credentials retrieved - User: %s", KeycloakUser))

    // LogDebug("Waiting 2 minutes for Keycloak to be fully ready...")
    // time.Sleep(2 * time.Minute)
    // LogDebug("Proceeding after wait period.")

    err := updateAppAdmin(KeycloakUser, KeycloakPassword)
    if err == nil {
        LogDebug("Successfully updated app admin")
    }

    fmt.Println("Getting Bearer Token...")
    AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
    if tokenErr != nil {
        LogFatalf("Error getting bearer token: %v", tokenErr)
    }

    AppAdminId, ProjectAdminId, ProjectViewerId, roleIdsErr = GetRoleId(AuthToken)
    if roleIdsErr != nil {
        LogFatalf("Error getting Role Ids: %v", roleIdsErr)
    }
    fmt.Println("AppAdminId:", AppAdminId)
    fmt.Println("ProjectAdminId:", ProjectAdminId)
    fmt.Println("ProjectViewerId:", ProjectViewerId)
}

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

func updateEnvVars(envPath string, updates map[string]string) error {
    input, err := os.ReadFile(envPath)
    if err != nil {
        return fmt.Errorf("failed to read .env file: %v", err)
    }
    lines := strings.Split(string(input), "\n")
    updated := make(map[string]bool)
    for i, line := range lines {
        for k, v := range updates {
            if strings.HasPrefix(line, k+"=") {
                lines[i] = fmt.Sprintf("%s=%s", k, v)
                updated[k] = true
            }
        }
    }
    // Add any new keys that weren't present
    for k, v := range updates {
        if !updated[k] {
            lines = append(lines, fmt.Sprintf("%s=%s", k, v))
        }
    }
    output := strings.Join(lines, "\n")
    return os.WriteFile(envPath, []byte(output), 0644)
}

func setupEnvironment(cpEndpoints, workerEndpoints []string) error {
    envPath := "../.env"
    updates := map[string]string{
        "JOB_SERVICE_URL":    "https://" + cpEndpoints[0],
        "CONFIG_SERVICE_URL": "https://" + cpEndpoints[0],
        "ADMIN_SERVICE_URL":  "https://" + cpEndpoints[0],
        "KEYCLOAK_IP":        cpEndpoints[0],
        "NDM_VM_HOST":        cpEndpoints[0],
        "NDM_WORKERS_HOST":   strings.Join(workerEndpoints, ","),
    }

    if err := updateEnvVars(envPath, updates); err != nil {
        return fmt.Errorf("failed to update .env file: %v", err)
    }

    // Set environment variables
    for k, v := range updates {
        os.Setenv(k, v)
    }

    // Update global variables
    JOB_SERVICE_URL = os.Getenv("JOB_SERVICE_URL")
    CONFIG_SERVICE_URL = os.Getenv("CONFIG_SERVICE_URL")
    ADMIN_SERVICE_URL = os.Getenv("ADMIN_SERVICE_URL")
    KEYCLOAK_IP = os.Getenv("KEYCLOAK_IP")
    NDM_VM_HOST = os.Getenv("NDM_VM_HOST")
    NDM_WORKERS_HOST = os.Getenv("NDM_WORKERS_HOST")

    return nil
}


// =============================================================================
// WORKER MANAGEMENT
// =============================================================================

func initWorkers() {
    workersHost := os.Getenv("NDM_WORKERS_HOST")
    if workersHost == "" {
        return
    }

    workers := strings.Split(workersHost, ",")
    for _, worker := range workers {
        availableWorkers = append(availableWorkers, SSHConfig{
            Host:     strings.TrimSpace(worker),
            Port:     22,
            Username: "ubuntu",
            Password: "",
        })
    }
}

func getAvailableWorkersCount() int {
    return len(availableWorkers)
}

func getAttachedWorkerCount() int {
    return len(attachedWorkersConfig)
}

func containsWorker(workers map[string]SSHConfig, worker SSHConfig) bool {
    for _, w := range workers {
        if w.Host == worker.Host {
            return true
        }
    }
    return false
}

func getWorkerIds() []string {
    workerIds := make([]string, 0, len(attachedWorkersConfig))
    for id := range attachedWorkersConfig {
        workerIds = append(workerIds, id)
    }
    return workerIds
}

func getGCPInstanceFromIP(ip string) (string, string, error) {
    cmd := exec.Command("gcloud", "compute", "instances", "list",
        "--filter", fmt.Sprintf("networkInterfaces[0].networkIP=%s", ip),
        "--format", "value(name,zone)",
    )

    output, err := cmd.CombinedOutput()
    if err != nil {
        return "", "", fmt.Errorf("failed to find instance with IP %s: %w, output: %s", ip, err, string(output))
    }

    outputStr := strings.TrimSpace(string(output))
    if outputStr == "" {
        return "", "", fmt.Errorf("no instance found with IP %s", ip)
    }

    parts := strings.Fields(outputStr)
    if len(parts) < 2 {
        return "", "", fmt.Errorf("unexpected output format: %s", outputStr)
    }

    instanceName := parts[0]
    zone := parts[1]

    if strings.Contains(zone, "/") {
        zoneParts := strings.Split(zone, "/")
        zone = zoneParts[len(zoneParts)-1]
    }

    return instanceName, zone, nil
}

func gcloudSSHRunScript(hostIP string, script string) (string, error) {
    instanceName, zone, err := getGCPInstanceFromIP(hostIP)
    if err != nil {
        return "", fmt.Errorf("failed to get instance info for IP %s: %w", hostIP, err)
    }

    LogDebug(fmt.Sprintf("Found GCP instance: %s in zone: %s for IP: %s", instanceName, zone, hostIP))

    tmpfile, err := ioutil.TempFile("", "worker-script-*.sh")
    if err != nil {
        return "", fmt.Errorf("failed to create temp file: %w", err)
    }
    defer os.Remove(tmpfile.Name())

    if _, err := tmpfile.WriteString(script); err != nil {
        return "", fmt.Errorf("failed to write script: %w", err)
    }
    if err := tmpfile.Close(); err != nil {
        return "", fmt.Errorf("failed to close temp file: %w", err)
    }

    remotePath := fmt.Sprintf("/tmp/worker_script_%d.sh", time.Now().Unix())
    copyCmd := exec.Command("gcloud", "compute", "scp",
        tmpfile.Name(),
        fmt.Sprintf("%s:%s", instanceName, remotePath),
        fmt.Sprintf("--zone=%s", zone),
        "--scp-flag=-o PubkeyAcceptedKeyTypes=+ssh-rsa",
    )

    LogDebug(fmt.Sprintf("Copying script to %s:%s", instanceName, remotePath))

    if output, err := copyCmd.CombinedOutput(); err != nil {
        return "", fmt.Errorf("failed to copy script: %w, output: %s", err, string(output))
    }

    execCmd := exec.Command("gcloud", "compute", "ssh",
        instanceName,
        fmt.Sprintf("--zone=%s", zone),
        "--ssh-flag=-o PubkeyAcceptedKeyTypes=+ssh-rsa",
        fmt.Sprintf("--command=sudo bash %s", remotePath),
    )

    LogDebug(fmt.Sprintf("Executing script on %s", instanceName))

    output, err := execCmd.CombinedOutput()
    if err != nil {
        LogDebug(fmt.Sprintf("Script execution completed with error: %v, output: %s", err, string(output)))
        return string(output), nil
    }

    cleanupCmd := exec.Command("gcloud", "compute", "ssh",
        instanceName,
        fmt.Sprintf("--zone=%s", zone),
        "--ssh-flag=-o PubkeyAcceptedKeyTypes=+ssh-rsa",
        fmt.Sprintf("--command=rm -f %s", remotePath),
    )
    cleanupCmd.Run()

    return string(output), nil
}

func sshRunScript(config SSHConfig, script string) (string, error) {
    return gcloudSSHRunScript(config.Host, script)
}

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

    fmt.Println("Response from worker registration request:", resp.Status)
    fmt.Println(resp)

    script, workerId, err := CreateWorkerScript(resp, projectId)
    if err != nil {
        return workerId, err
    }
    fmt.Println("Worker Registration Script:\n", script)
    LogDebug(fmt.Sprintf("For worker %s, running script: %s", worker.Host, script))
    output, err := sshRunScript(worker, script)
    if err != nil {
        return workerId, err
    }
    LogDebug(fmt.Sprintf("Output from worker %s: %s", worker.Host, output))
    return workerId, nil
}

func attachWorkers(count int, authToken, accountId, projectId string) (map[string]SSHConfig, error) {
    if count > getAvailableWorkersCount() {
        LogError(fmt.Sprintf("Requested %d workers, but only %d available", count, getAvailableWorkersCount()))
        return nil, errors.New("requested count exceeds total available workers")
    }

    current := getAttachedWorkerCount()
    if current > count {
        return nil, errors.New("already attached more workers than requested; please detach first")
    }

    needed := count - current

    for _, workerConfig := range availableWorkers {
        if needed == 0 {
            break
        }
        if containsWorker(attachedWorkersConfig, workerConfig) {
            continue
        }
        workerId, err := attachWorkerForConfig(workerConfig, authToken, accountId, projectId)
        if err != nil {
            return nil, fmt.Errorf("failed to attach worker %s: %w", workerConfig.Host, err)
        }
        LogDebug(fmt.Sprintf("Successfully registered worker %s with workerId: %s", workerConfig.Host, workerId))
        attachedWorkersConfig[workerId] = workerConfig
        needed--
    }
    if getAttachedWorkerCount() != count {
        return nil, errors.New("failed to attach the required number of workers")
    }
    return attachedWorkersConfig, nil
}

func setupTestEnv(workerCount int) (string, map[string]SSHConfig, error) {
    projectId, err := CreateProject(AuthToken, AccountId)
    if err != nil {
        return "", nil, fmt.Errorf("failed to create project: %w", err)
    }
    LogDebug(fmt.Sprintf("Project created with ID: %s", projectId))

    attachedWorkersConfig, err := attachWorkers(workerCount, AuthToken, AccountId, projectId)
    if err != nil {
        return "", nil, fmt.Errorf("failed to attach workers: %w", err)
    }

    if len(attachedWorkersConfig) == 0 {
        return "", nil, fmt.Errorf("failed to attach workers: worker may have been already attached")
    }

    workerIds := getWorkerIds()
    for i := 0; i < MaxPollRetries; i++ {
        workerIdWithStatus, err := GetWorkerStatus(projectId, workerIds)
        if err != nil {
            return "", nil, fmt.Errorf("error getting worker status: %w", err)
        }
        onlineWorkers := 0
        for _, workerId := range workerIds {
            if workerIdWithStatus[workerId] == "Online" {
                LogDebug(fmt.Sprintf("Worker %s is Online", workerId))
                onlineWorkers++
            }
        }
        if onlineWorkers == len(workerIds) {
            LogDebug("All workers are Online")
            break
        }
        Wait(DefaultPollInterval)
    }
    LogDebug("Test environment setup complete and all worker are Online")
    return projectId, attachedWorkersConfig, nil
}

// =============================================================================
// SCRIPT EXECUTION UTILITIES
// =============================================================================

func RunInteractiveScriptPTY(scriptPath, workDir string) (string, error) {
    full := filepath.Join(workDir, scriptPath)
    if _, err := os.Stat(full); err != nil {
        return "", fmt.Errorf("script not found: %s: %w", full, err)
    }

    cmd := exec.Command("bash", scriptPath)
    cmd.Dir = workDir

    ptmx, err := pty.Start(cmd)
    if err != nil {
        return "", fmt.Errorf("failed to start PTY: %w", err)
    }
    defer func() { _ = ptmx.Close() }()

    var buf bytes.Buffer
    go func() { _, _ = io.Copy(ptmx, os.Stdin) }()
    mw := io.MultiWriter(os.Stdout, &buf)
    go func() { _, _ = io.Copy(mw, ptmx) }()

    err = cmd.Wait()
    return buf.String(), err
}

// =============================================================================
// CONTROL PLANE READINESS
// =============================================================================

func waitForControlPlaneReadyWithIP(cpIP string) error {
    fmt.Printf("   🎯 Monitoring Control Plane at: %s\n", cpIP)

    startTime := time.Now()
    fmt.Printf("   ⏰ Starting monitoring at: %s\n", startTime.Format("15:04:05"))

    // Step 1: Wait for ping response
    fmt.Println("   📡 Waiting for VM to be pingable...")
    var firstPingTime time.Time
    for i := 0; i < 60; i++ {
        cmd := exec.Command("ping", "-c", "1", cpIP)
        if cmd.Run() == nil {
            firstPingTime = time.Now()
            pingDuration := firstPingTime.Sub(startTime)
            fmt.Printf("   ✅ VM is now pingable! (took %v)\n", pingDuration)
            fmt.Printf("   📡 First ping successful at: %s\n", firstPingTime.Format("15:04:05"))
            break
        }
        if i == 59 {
            return fmt.Errorf("VM not pingable after 5 minutes")
        }
        time.Sleep(5 * time.Second)
        fmt.Print(".")
    }

    // Step 2: Wait for HTTP response and full UI availability
    fmt.Println("   🌐 Waiting for Control Plane UI to be fully ready...")
    fmt.Println("   ⏰ This can take 30-60 minutes for first-time boot...")
    url := fmt.Sprintf("https://%s", cpIP)

    client := &http.Client{
        Timeout: 15 * time.Second,
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
        },
    }

    maxWaitMinutes := 60
    maxAttempts := maxWaitMinutes * 12

    for i := 0; i < maxAttempts; i++ {
        currentTime := time.Now()
        totalElapsed := currentTime.Sub(startTime)
        sincePing := currentTime.Sub(firstPingTime)

        resp, err := client.Get(url)
        if err == nil {
            resp.Body.Close()
            if resp.StatusCode == 200 {
                fmt.Printf("   ✅ Control Plane UI is fully ready! (Total time: %v, Since ping: %v)\n",
                    totalElapsed, sincePing)
                fmt.Printf("   🎉 UI ready at: %s\n", currentTime.Format("15:04:05"))
                return nil
            } else if resp.StatusCode == 404 || resp.StatusCode == 503 {
                if i%60 == 0 {
                    fmt.Printf("   ⏳ Status: %d (services still starting up... %d/%d minutes, total elapsed: %v)\n",
                        resp.StatusCode, i/12+1, maxWaitMinutes, totalElapsed)
                }
            } else {
                fmt.Printf("   ⚠️  Unexpected status: %d (Total elapsed: %v)\n", resp.StatusCode, totalElapsed)
            }
        } else {
            if i%120 == 0 {
                fmt.Printf("   🔌 Connection attempt %d/%d (total elapsed: %v, still waiting for services...)\n",
                    i/12+1, maxWaitMinutes, totalElapsed)
            }
        }

        time.Sleep(5 * time.Second)

        if i%60 == 0 && i > 0 {
            fmt.Printf("   ⏳ Still waiting... (%d/%d minutes, total elapsed: %v, since ping: %v) - NDM services are starting up\n",
                i/12, maxWaitMinutes, totalElapsed, sincePing)
        }

        if i == 180 {
            fmt.Printf("   💡 15 minutes elapsed (total: %v). NDM boot process typically takes 20-45 minutes...\n", totalElapsed)
        }
        if i == 360 {
            fmt.Printf("   💡 30 minutes elapsed (total: %v). This is normal for first-time boot. Continuing to wait...\n", totalElapsed)
        }
    }

    finalElapsed := time.Now().Sub(startTime)
    return fmt.Errorf("Control Plane UI did not become ready within %d minutes (total elapsed: %v)", maxWaitMinutes, finalElapsed)
}

// =============================================================================
// MIGRATION WORKFLOW PHASES
// =============================================================================

func (e *EndToEndMigration) setupProjectAndWorker() error {
    e.logOperation("Phase 1: Setting up project and attaching worker")

    numberOfWorkers := len(e.workerEndpoints)
    projectId, attachedWorkersConfig, err := setupTestEnv(numberOfWorkers)
    if err != nil {
        return fmt.Errorf("error during test environment setup: %v", err)
    }

    if len(attachedWorkersConfig) != numberOfWorkers {
        return fmt.Errorf("expected %d worker to be attached, got %d", numberOfWorkers, len(attachedWorkersConfig))
    }

    workerIds := getWorkerIds()
    if len(workerIds) == 0 {
        return fmt.Errorf("no workers found")
    }

    e.projectId = projectId
    e.workerId = workerIds
    e.attachedWorkersConfig = attachedWorkersConfig
    e.headers = GetHeaders(AuthToken, ContentTypeJSON)

    e.logOperation(fmt.Sprintf("✓ Project created: %s", e.projectId))
    e.logOperation(fmt.Sprintf("✓ Worker attached: %s", e.workerId))
    return nil
}

func (e *EndToEndMigration) createSourceFileServer() error {
    e.logOperation("Phase 2: Creating source file server with volume")

    e.sourceVolumePath = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME)

    sourceParams := CreateServereParams{
        ConfigName:       "LINUX_SRC",
        ConfigType:       ConfigTypeFile,
        ProjectID:        e.projectId,
        ServerType:       ServerTypeOtherNAS,
        UserName:         "Root",
        Password:         "",
        Protocol:         ProtocolNFS,
        ProtocolVersion:  ProtocolVersionNFS_V3,
        Host:             "172.30.121.91",
        Workers:          e.workerId,
        WorkingDirectory: "",
    }

    sourceConfigId, resp, err := CreateFileServer(sourceParams, e.headers)
    if err != nil {
        return fmt.Errorf("error creating source file server: %v", err)
    }
    defer resp.Body.Close()

    fmt.Println("src:", resp)

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("expected HTTP 200, got %d", resp.StatusCode)
    }

    e.sourceConfigId = sourceConfigId
    e.logOperation(fmt.Sprintf("✓ Source file server created with config name '%s': %s", sourceParams.ConfigName, e.sourceConfigId))

    // time.Sleep(60 * time.Second)

    sourcePathId, err := GetExportPathID("source", "/nfs/LargeAI", e.sourceConfigId, e.headers)
    if err != nil {
        return fmt.Errorf("error getting source export path ID: %v", err)
    }

    e.sourcePathId = sourcePathId
    e.logOperation(fmt.Sprintf("✓ Source volume path created: %s", e.sourcePathId))

    return nil
}

func (e *EndToEndMigration)  createDestinationVolume() error {
    e.logOperation("Phase 2.1: Setting up destination volume")

    scriptPath := "run.sh"

    fmt.Println("\n🔧 Running NetApp volume deployment script...")
    fmt.Println("Please follow the prompts to create your destination volume.")
    fmt.Println("When prompted, enter one of the available storage pools shown above.")

    output, err := RunInteractiveScriptPTY(scriptPath, "GCP_vol")
    if err != nil {
        return fmt.Errorf("failed to run NetApp volume deployment script: %v", err)
    }
    fmt.Println(output)

    e.logOperation("✓ NetApp volume deployment script completed")

    var mountPath string
    var destIP string
    lines := strings.Split(output, "\n")
    for _, line := range lines {
        line = strings.TrimSpace(line)
        if strings.Contains(line, ":/") {
            parts := strings.SplitN(line, ":", 2)
            if len(parts) == 2 {
                destIP = strings.TrimSpace(parts[0])
                mountPath = strings.TrimSpace(parts[1])
                break
            }
        } else if strings.HasPrefix(line, "/vol") {
            mountPath = line
            break
        }
    }

    if mountPath == "" {
        fmt.Print("\nCould not detect mount path. Please enter it manually (e.g., /vol1): ")
        reader := bufio.NewReader(os.Stdin)
        mountPath, err = reader.ReadString('\n')
        if err != nil {
            return fmt.Errorf("failed to read mount path: %v", err)
        }
    }
    mountPath = strings.TrimSpace(mountPath)
    mountPath = strings.Trim(mountPath, "\",")

    if mountPath == "" {
        return fmt.Errorf("mount path cannot be empty")
    }

    e.destmountPath = mountPath
    e.DestinationIP = destIP
    e.DestinationIP = strings.Trim(e.DestinationIP, "\"")

    e.logOperation(fmt.Sprintf("✓ Destination mount path set: %s", e.destmountPath))
    e.logOperation(fmt.Sprintf("✓ Destination IP set: %s", e.DestinationIP))

    return nil
}

func (e *EndToEndMigration) createDestinationFileServer() error {
    e.logOperation("Phase 3: Creating destination file server with volume")

    e.destinationVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME)

    destinationParams := CreateServereParams{
        ConfigName:       "GCP_DEST",
        ConfigType:       ConfigTypeFile,
        ProjectID:        e.projectId,
        ServerType:       ServerTypeOtherNAS,
        UserName:         "Root",
        Password:         "",
        Protocol:         ProtocolNFS,
        ProtocolVersion:  ProtocolVersionNFS_V3,
        Host:             e.DestinationIP,
        Workers:          e.workerId,
        WorkingDirectory: "",
    }

    destinationConfigId, resp, err := CreateFileServer(destinationParams, e.headers)
    if err != nil {
        return fmt.Errorf("error creating destination file server: %v", err)
    }
    defer resp.Body.Close()

    fmt.Println("dest:", resp)

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("expected HTTP 200, got %d", resp.StatusCode)
    }

    e.destinationConfigId = destinationConfigId
    e.logOperation(fmt.Sprintf("✓ Destination file server created with config name '%s': %s", destinationParams.ConfigName, e.destinationConfigId))

    // fmt.Println("Waiting 2 minutes for destination file server to be ready...")
    // time.Sleep(2 * time.Minute)
    // fmt.Println("Proceeding after wait period.")

    fmt.Println("Getting destination export path ID...")
    destinationPathId, err := GetExportPathID("destination", e.destmountPath, e.destinationConfigId, e.headers)
    if err != nil {
        return fmt.Errorf("error getting destination export path ID: %v", err)
    }

    e.destinationPathId = destinationPathId
    e.logOperation(fmt.Sprintf("✓ Destination volume path created: %s", e.destinationPathId))

    return nil
}

func (e *EndToEndMigration) performSourceDiscovery() error {
    e.logOperation("Phase 4: Performing source discovery")

    jobParams := DiscoveryJobParams{
        SourcePathIDs:            []string{e.sourcePathId},
        ExcludeOlderThan:         nil,
        ExcludeFilePatterns:      "",
        PreserveAccessTime:       false,
        FirstRunAt:               GetCurrentUTCTimestamp(),
        CreatedBy:                nil,
        WorkflowExecutionTimeout: "60s",
        WorkflowTaskTimeout:      "30s",
        WorkflowRunTimeout:       "30s",
        StartDelay:               "10s",
    }

    discoveryJobConfigIds, resp, err := CreateDiscoveryJob(jobParams, e.headers)
    if err != nil {
        return fmt.Errorf("error creating source discovery job: %v", err)
    }
    defer resp.Body.Close()

    fmt.Println("Source discovery job creation response status:", resp.Status)
    if len(discoveryJobConfigIds) == 0 {
        return fmt.Errorf("no discovery job config IDs returned")
    }

    e.discoveryJobConfigId = discoveryJobConfigIds[0]
    e.logOperation(fmt.Sprintf("✓ Source discovery job created: %s", e.discoveryJobConfigId))

    // Wait for job to start (following e2e test pattern)
    Wait(30)

    // Get job run details and monitor execution
    jobConfigDetails, resp, err := GetJobRunDetails(e.discoveryJobConfigId, e.headers, false)
    if err != nil {
        return fmt.Errorf("error getting job run details: %v", err)
    }
    defer resp.Body.Close()

    fmt.Println("Source discovery job creation response status:", resp.Status)

    if len(jobConfigDetails.JobRuns) == 0 {
        return fmt.Errorf("no job runs found for discovery job")
    }

    discoveryJobRunId := jobConfigDetails.JobRuns[0].JobRunId
    e.logOperation(fmt.Sprintf("✓ Source discovery job started: %s", discoveryJobRunId))

    fmt.Println("Waiting for source discovery job to complete...")
    err = WaitForJobState(discoveryJobRunId, COMPLETED_JOBRUN)
    if err != nil {
        return fmt.Errorf("source discovery job %s did not complete: %v", discoveryJobRunId, err)
    }

    e.logOperation("✓ Source discovery completed successfully")
    return nil
}

func (e *EndToEndMigration) performDestinationDiscovery() error {
    e.logOperation("Phase 5: Performing destination discovery")

    destJobParams := DiscoveryJobParams{
        SourcePathIDs:            []string{e.destinationPathId},
        ExcludeOlderThan:         nil,
        ExcludeFilePatterns:      "",
        PreserveAccessTime:       false,
        FirstRunAt:               GetCurrentUTCTimestamp(),
        CreatedBy:                nil,
        WorkflowExecutionTimeout: "60s",
        WorkflowTaskTimeout:      "30s",
        WorkflowRunTimeout:       "30s",
        StartDelay:               "10s",
    }

    destinationDiscoveryJobConfigIds, resp, err := CreateDiscoveryJob(destJobParams, e.headers)
    if err != nil {
        return fmt.Errorf("error creating destination discovery job: %v", err)
    }
    defer resp.Body.Close()

    if len(destinationDiscoveryJobConfigIds) == 0 {
        return fmt.Errorf("no destination discovery job config IDs returned")
    }

    destDiscoveryJobConfigId := destinationDiscoveryJobConfigIds[0]
    e.logOperation(fmt.Sprintf("✓ Destination discovery job created: %s", destDiscoveryJobConfigId))

    // Wait for job to start (following e2e test pattern)
    Wait(30)

    // Get job run details and monitor execution
    destJobConfigDetails, resp, err := GetJobRunDetails(destDiscoveryJobConfigId, e.headers, false)
    if err != nil {
        return fmt.Errorf("error getting destination job run details: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("expected HTTP 200 OK for destination job run details, got %d", resp.StatusCode)
    }

    if len(destJobConfigDetails.JobRuns) == 0 {
        return fmt.Errorf("no job runs found for destination discovery job")
    }

    destDiscoveryJobRunId := destJobConfigDetails.JobRuns[0].JobRunId
    e.logOperation(fmt.Sprintf("✓ Destination discovery job started: %s", destDiscoveryJobRunId))

    fmt.Println("Waiting for destination discovery job to complete...")
    err = WaitForJobState(destDiscoveryJobRunId, COMPLETED_JOBRUN)
    if err != nil {
        return fmt.Errorf("destination discovery job %s did not complete: %v", destDiscoveryJobRunId, err)
    }

    e.logOperation("✓ Destination discovery completed successfully")
    return nil
}

func findJobConfigByRun(status string) ([]string, error) {
    // Build URL with status filter
    url := fmt.Sprintf("%s/api/v1/jobs/runs?status=%s", JOB_SERVICE_URL, status)
    
    headers := GetHeaders(AuthToken, ContentTypeJSON)
    resp, err := SendAPIRequest(http.MethodGet, url, nil, headers)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    bodyBytes, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    
    // Parse response
    type JobRunsResponse struct {
        Data struct {
            Items []struct {
                JobConfigId string `json:"jobConfigId"`
                ID          string `json:"id"`
                ConfigId    string `json:"configId"`
            } `json:"items"`
        } `json:"data"`
    }
    
    var response JobRunsResponse
    if err := json.Unmarshal(bodyBytes, &response); err != nil {
        return nil, err
    }

    var jobConfigIds []string
    for _, item := range response.Data.Items {
        configId := item.JobConfigId
        if configId == "" {
            configId = item.ID
        }
        if configId == "" {
            configId = item.ConfigId
        }
        if configId != "" {
            jobConfigIds = append(jobConfigIds, configId)
        }
    }
    
    return jobConfigIds, nil
}

func (e *EndToEndMigration) executeMigration() error {

    migrationStartTime := time.Now()
    e.logOperation("Phase 6: Executing migration")

    migrationParams := MigrationJobParams{
        FirstRunAt:         GetCurrentUTCTimestamp(),
        FutureRunSchedule:  "",
        SourcePathIDs:      []string{e.sourcePathId},
        DestinationPathIDs: []string{e.destinationPathId},
        SidMapping:         false,
        Options: map[string]interface{}{
            "excludeFilePatterns": "*/snapshots/*, */logs/*, */tmp/*",
            "preserveAccessTime":  true,
            "skipFile":            "15-M",
        },
    }

    migrationJobConfigIds, resp, err := CreateMigrationJob(migrationParams, e.headers)
    fmt.Println("response for job creation :", resp)
    if err != nil {
        return fmt.Errorf("error creating migration job: %v", err)
    } 
    
    defer resp.Body.Close()

    if len(migrationJobConfigIds) == 0 {
        time.Sleep(30 * time.Second)
        migrationJobConfigIds, err = findJobConfigByRun("READY")
        if err != nil || len(migrationJobConfigIds) == 0 {
            migrationJobConfigIds, err = findJobConfigByRun("RUNNING")
        }
        if err != nil || len(migrationJobConfigIds) == 0 {
            return fmt.Errorf("no migration job config IDs found")
        }
    }

    e.migrationJobConfigIds = migrationJobConfigIds
    e.logOperation(fmt.Sprintf("✓ Migration jobs created: %v", migrationJobConfigIds))

    // Wait for jobs to start before monitoring (following e2e test pattern)
    Wait(30)

    for i, migrationJobConfigID := range migrationJobConfigIds {
        e.logOperation(fmt.Sprintf("Monitoring migration job %d/%d: %s", i+1, len(migrationJobConfigIds), migrationJobConfigID))

        getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, e.headers, false)
        if err != nil {
            return fmt.Errorf("error getting migration job run details: %v", err)
        }
        defer resp.Body.Close()

        if resp.StatusCode != http.StatusOK {
            return fmt.Errorf("expected HTTP 200 OK for migration job run details, got %d", resp.StatusCode)
        }

        if len(getJobsResp.JobRuns) == 0 {
            return fmt.Errorf("no job runs found for migration job %s", migrationJobConfigID)
        }

        migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
        e.logOperation(fmt.Sprintf("✓ Migration job %d started: %s", i+1, migrationJobRunID))

        err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
        if err != nil {
            return fmt.Errorf("migration job %s did not complete: %v", migrationJobRunID, err)
        }

        e.logOperation(fmt.Sprintf("✓ Migration job %d completed successfully", i+1))
    }

    migrationEndTime := time.Now()
    migrationDuration := migrationEndTime.Sub(migrationStartTime)
    e.logOperation("✓ All migration jobs completed successfully")

    e.logOperation(fmt.Sprintf("Migration completed at: %s", migrationEndTime.Format("2006-01-02 15:04:05")))
    e.logOperation(fmt.Sprintf("Total migration duration: %s (%.2f minutes)", migrationDuration.String(), migrationDuration.Minutes()))

    return nil
}

func (e *EndToEndMigration) performCutover() error {
    e.logOperation("Phase 7: Performing cutover")

    cutoverParams := BulkCutoverJobParams{
        SourcePathIDs:      []string{e.sourcePathId},
        DestinationPathIDs: []string{e.destinationPathId},
    }

    cutoverJobConfigIds, resp, err := CreateBulkCutoverJob(cutoverParams, e.headers)
    if err != nil {
        return fmt.Errorf("error creating bulk cutover job: %v", err)
    }
    defer resp.Body.Close()

    if len(cutoverJobConfigIds) == 0 {
        return fmt.Errorf("no cutover job config IDs returned")
    }

    e.cutoverJobConfigIds = cutoverJobConfigIds
    e.logOperation(fmt.Sprintf("✓ Cutover jobs created: %v", cutoverJobConfigIds))

    // Wait for cutover jobs to start (following e2e test pattern)
    Wait(30)

    return nil
}

func (e *EndToEndMigration) approveCutover() error {
    e.logOperation("Phase 7.1: Approving cutover jobs")

    if len(e.cutoverJobConfigIds) == 0 {
        return fmt.Errorf("no cutover job config IDs available for approval")
    }

    var cutoverRunIDs []string

    // First, get all the cutover run IDs and wait for them to reach BLOCKED state
    for _, jobConfigID := range e.cutoverJobConfigIds {
        e.logOperation(fmt.Sprintf("Getting cutover job run details for config: %s", jobConfigID))
        
        getJobsResp, resp, err := GetJobRunDetails(jobConfigID, e.headers, false)
        if err != nil {
            return fmt.Errorf("error getting blocked job run ID for config %s: %v", jobConfigID, err)
        }
        defer resp.Body.Close()

        if resp.StatusCode != http.StatusOK {
            return fmt.Errorf("expected HTTP 200 OK for cutover job details, got %d", resp.StatusCode)
        }

        if len(getJobsResp.JobRuns) == 0 {
            return fmt.Errorf("no job runs found for cutover config %s", jobConfigID)
        }

        cutoverRunID := getJobsResp.JobRuns[0].JobRunId
        if cutoverRunID == "" {
            return fmt.Errorf("expected a valid cutoverID for config %s", jobConfigID)
        }

        e.logOperation(fmt.Sprintf("Waiting for cutover job %s to reach BLOCKED state", cutoverRunID))
        
        // Wait for the job to reach BLOCKED state
        err = WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)
        if err != nil {
            return fmt.Errorf("cutover job %s did not reach BLOCKED state: %v", cutoverRunID, err)
        }

        // Fetch the latest status to confirm BLOCKED state
        getJobsResp, resp, err = GetJobRunDetails(jobConfigID, e.headers, false)
        if err != nil {
            return fmt.Errorf("error getting updated job status for config %s: %v", jobConfigID, err)
        }
        defer resp.Body.Close()

        if resp.StatusCode != http.StatusOK {
            return fmt.Errorf("expected HTTP 200 OK for updated job status, got %d", resp.StatusCode)
        }

        if len(getJobsResp.JobRuns) == 0 {
            return fmt.Errorf("no job runs found for config %s after blocking", jobConfigID)
        }

        latestStatus := getJobsResp.JobRuns[0].Status
        if latestStatus != "BLOCKED" {
            return fmt.Errorf("expected status BLOCKED for config %s, got %s", jobConfigID, latestStatus)
        }

        cutoverRunIDs = append(cutoverRunIDs, cutoverRunID)
        e.logOperation(fmt.Sprintf("✓ Cutover job %s is in BLOCKED state and ready for approval", cutoverRunID))
    }

    // Now approve all the cutover jobs
    e.logOperation("Approving all cutover jobs...")
    for _, cutoverRunID := range cutoverRunIDs {
        e.logOperation(fmt.Sprintf("Approving cutover job: %s", cutoverRunID))
        
        resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", e.headers)
        if err != nil {
            return fmt.Errorf("error approving bulk cutover job for run %s: %v", cutoverRunID, err)
        }
        defer resp.Body.Close()

        if resp.StatusCode != http.StatusOK {
            return fmt.Errorf("expected HTTP 200 OK for cutover approval, got %d for run %s", resp.StatusCode, cutoverRunID)
        }

        e.logOperation(fmt.Sprintf("✓ Cutover job %s approved successfully", cutoverRunID))
    }

    return nil
}

func clearVolume(export string) error {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = ClearVolumeForSMB(export)
	case ProtocolNFS:
		script = ClearVolumeForNFS(export)
	}

	// config := GetAttachedWorkerDetails()

	// sshConfig = SSHConfig{
	// 	Username: config.Username,
	// 	Host:     config.Host,
	// 	Port:     config.Port,
	// 	Password: config.Password,
	// }

    fmt.Println("Script to clear volume:\n", script)
    for _, workerConfig := range availableWorkers {
        output, err := sshRunScript(workerConfig, script)
        if err != nil {
            return fmt.Errorf("RemoveDataFromFileserver failed: %w\noutput: %s", err, output)
        }

        fmt.Println("Output from clearing volume on worker", workerConfig.Host, ":\n", output)
        break // Clear on the first available worker and exit
    }
    return nil
	
}

func (e *EndToEndMigration) storeLogs() error {
    e.logOperation("Phase 8: Storing migration logs")

    logFile := fmt.Sprintf("/tmp/migration_logs_%s_%s.log", e.projectId, time.Now().Format("20060102_150405"))

    file, err := os.Create(logFile)
    if err != nil {
        return fmt.Errorf("error creating log file: %v", err)
    }
    defer file.Close()

    for _, logEntry := range e.migrationLogs {
        if _, err := file.WriteString(logEntry + "\n"); err != nil {
            return fmt.Errorf("error writing to log file: %v", err)
        }
    }

    e.logOperation(fmt.Sprintf("✓ Logs stored in: %s", logFile))
    return nil
}


func (e *EndToEndMigration) logOperation(message string) {
    timestamp := time.Now().Format("2006-01-02 15:04:05")
    logEntry := fmt.Sprintf("[%s] %s", timestamp, message)
    e.migrationLogs = append(e.migrationLogs, logEntry)
    fmt.Println(logEntry)
}


// =============================================================================
// MAIN EXECUTION WORKFLOW
// =============================================================================

func (e *EndToEndMigration) Execute() error {
    e.logOperation("=== Starting End-to-End Migration Execution ===")

    sourceConfigs := []SourceConfig{
        // {"172.30.121.91", "/nfs/LargeAI", "LINUX_SRC_LARGE"},
        {"172.30.121.91", "/nfs/swbuild20g", "LINUX_SRC_SMALL"},
        // {"172.30.121.91", "/nfs/SWBUILD_ds", "LINUX_SRC_SMALL"},
    }
    
    fmt.Println("Received worker registration response")
    PROTOCOL_TYPE = Protocol("NFS")
    CLOUD_ENVIRONMENT = CloudEnvironment("GCP")
    fmt.Println("Updated configuration variables for NFS and GCP")

	fmt.Println("Waiting for services to stabilize...")
	Wait(6 * 60) // Wait for 5 minutes to ensure services are up
    fmt.Println("Services should be stabilized now.")

    initTestEnv()

    fmt.Println("Available Workers:", getAvailableWorkersCount())

    // // Execute all migration phases
    if err := e.setupProjectAndWorker(); err != nil {
        return fmt.Errorf("project and worker setup failed: %v", err)
    }
    // ########
    if err := e.createSourceFileServer(); err != nil {
        return fmt.Errorf("source file server creation failed: %v", err)
    }
    // ########

    // for perf run
    // e.projectId = "9e594934-9bc5-4425-97b9-5686dcb92d36"
    // e.workerId = []string{"8508a2f2-040d-48d8-81e1-f28c89d0e7e6"}
    // e.attachedWorkersConfig = attachedWorkersConfig
    // e.headers = GetHeaders(AuthToken, ContentTypeJSON)
    // e.sourceConfigId = "12884630-e9d1-45fb-be92-2001deebeda8"

    // for abhishek test
    // e.projectId = "d0c80520-7f54-4300-85a1-92add5871b38"
    // e.workerId = "e5366a3b-d648-4178-9241-cc06d66177e1"
    // e.attachedWorkersConfig = attachedWorkersConfig
    // e.headers = GetHeaders(AuthToken, ContentTypeJSON)
    // e.sourceConfigId = "577a7ff5-b670-465d-96b1-92accc5fdf51"

    // ############
    if err := e.createDestinationVolume(); err != nil {
        return fmt.Errorf("destination volume creation failed: %v", err)
    }
    
    if err := e.createDestinationFileServer(); err != nil {
        return fmt.Errorf("destination file server creation failed: %v", err)
    }
    // ###########
    
    // e.destinationConfigId = "91236cb7-e742-4835-82e3-dcbd2ca56a10"
    // destinationPathId, err := GetExportPathID("source",  e.destmountPath, e.destinationConfigId, e.headers)
    // if err != nil {
    //     return fmt.Errorf("error getting source export path ID: %v", err)
    // }

    for i := 0; i < 1; i++ {
        
        // if err := e.createDestinationVolume(); err != nil {
        // return fmt.Errorf("destination volume creation failed: %v", err)
        // }

        // if err := e.createDestinationFileServer(); err != nil {
        //     return fmt.Errorf("destination file server creation failed: %v", err)
        // }
        // for perf run
        // e.destmountPath = "/perf-run-final"
        // e.destinationConfigId = "91236cb7-e742-4835-82e3-dcbd2ca56a10"
        // e.DestinationIP = "10.127.176.21"

        
        // // for abhishek test
        // e.destmountPath = "/abhi-test-dk-1"
        // e.destinationConfigId = "8e00f318-0f1a-4869-8a30-f1616ce4ad52"
        // e.DestinationIP = "10.127.176.21"

        destinationPathId, err := GetExportPathID("destination",  e.destmountPath, e.destinationConfigId, e.headers)
        if err != nil {
            return fmt.Errorf("error getting destination export path ID: %v", err)
        }

        e.destinationPathId = destinationPathId
        e.logOperation(fmt.Sprintf("✓ Destination volume path created: %s", e.destinationPathId))

        for i, sourceConfig := range sourceConfigs{
            e.logOperation(fmt.Sprintf("=== Migration Loop %d/%d: %s ===", 
                i+1, len(sourceConfigs), sourceConfig.ConfigName))

            sourcePathId, err := GetExportPathID("source", sourceConfig.Volume, e.sourceConfigId, e.headers)
            if err != nil {
                return fmt.Errorf("error getting source export path ID: %v", err)
            }

            e.sourcePathId = sourcePathId
            e.logOperation(fmt.Sprintf("✓ Source volume path created: %s", e.sourcePathId))

            
            if err := e.executeMigration(); err != nil {
                return fmt.Errorf("migration execution failed: %v", err)
            }

            destinationVolumePath1 := fmt.Sprintf("%s:%s", e.DestinationIP, e.destmountPath)

            fmt.Println(time.Now().Format("2006-01-02 15:04:05"), " - Clearing destination volume for next migration...")
            err = clearVolume(destinationVolumePath1)
            if err != nil {
                return fmt.Errorf("failed to clear destination volume: %v", err)
            }
            e.logOperation("✓ Cleared destination volume for next migration")
            fmt.Println(time.Now().Format("2006-01-02 15:04:05"), " - Destination volume cleared successfully.")

            fmt.Println("Waiting 30 minutes before next migration...")
            e.logOperation("Waiting 30 minutes before next migration...")
            time.Sleep(30 * time.Minute)
            e.logOperation("Proceeding after wait period.")

        }
    }
    

    

    // if err := e.performSourceDiscovery(); err != nil {
    //     return fmt.Errorf("source discovery failed: %v", err)
    // }

    // if err := e.performDestinationDiscovery(); err != nil {
    //     return fmt.Errorf("destination discovery failed: %v", err)
    // }



    // if err := e.executeMigration(); err != nil {
    //     return fmt.Errorf("migration execution failed: %v", err)
    // }


    // if err := e.performCutover(); err != nil {
    //     return fmt.Errorf("cutover failed: %v", err)
    // }

    // if err := e.approveCutover(); err != nil {
    //     return fmt.Errorf("cutover approval failed: %v", err)
    // }

    if err := e.storeLogs(); err != nil {
        return fmt.Errorf("log storage failed: %v", err)
    }

    e.logOperation("=== End-to-End Migration Completed Successfully ===")
    return nil
}

func main() {
    // Creating the cp and worker using Terraform
    infraMgr := InfrastructureManager{
     runScript:    "perf-nfs-script.sh",
     terraformDir: "../../../app-deployment/terraform/gcp",
    }

    if err := infraMgr.RunScript(); err != nil {
     log.Fatalf("Infrastructure deployment failed: %v", err)
    }

    fmt.Println("CP and Worker created successfully")

    // Getting the CP and Worker IPs
    outputs, err := infraMgr.GetOutputs()
    if err != nil {
     log.Fatalf("Failed to get terraform outputs: %v", err)
    }

    // Print the IPs
    if cpIPs, ok := outputs["control_plane_internal_ips"]; ok {
     fmt.Printf("Control Plane Internal IPs: %v\n", cpIPs)
    }
    if workerIPs, ok := outputs["worker_internal_ips"]; ok {
     fmt.Printf("Worker Internal IPs: %v\n", workerIPs)
    }

    cpEndpoints := outputs["control_plane_internal_ips"]
    workerEndpoints := outputs["worker_internal_ips"]

    // // for perf run  for abhishek deleted worker
    // cpEndpoints :=[]string{"172.30.121.82"}
    // workerEndpoints := []string{"172.30.121.90"}

    // // for perf run  for abhishek deleted worker now no worker attached
    // cpEndpoints :=[]string{"172.30.121.68"}
    // workerEndpoints := []string{"172.30.121.83"}


    // for perf run final
    // cpEndpoints :=[]string{"172.30.121.88"}
    // workerEndpoints := []string{"172.30.121.73"}

    // ship stopper doing back to back migration for SWbuild data as shefa asked 
    // cpEndpoints :=[]string{"172.30.121.67"}
    // workerEndpoints := []string{"172.30.121.86", "172.30.121.84"}

    // // performed with 10con to validate
    // cpEndpoints :=[]string{"172.30.121.81"}
    // workerEndpoints := []string{"172.30.121.83", "172.30.121.85"}

    // // for testing with concurrency 10 with 4 worker for eda
    // cpEndpoints :=[]string{"172.30.121.86"}
    // workerEndpoints := []string{"172.30.121.88", "172.30.121.82", "172.30.121.84", "172.30.121.79"}


    if err := setupEnvironment(cpEndpoints, workerEndpoints); err != nil {
        log.Fatalf("Environment setup failed: %v", err)
    }

    fmt.Println("Environment Variables:")
    fmt.Printf("  JOB_SERVICE_URL: %s\n", JOB_SERVICE_URL)
    fmt.Printf("  CONFIG_SERVICE_URL: %s\n", CONFIG_SERVICE_URL)
    fmt.Printf("  ADMIN_SERVICE_URL: %s\n", ADMIN_SERVICE_URL)
    fmt.Printf("  KEYCLOAK_IP: %s\n", KEYCLOAK_IP)
    fmt.Printf("  NDM_VM_HOST: %s\n", NDM_VM_HOST)
    fmt.Printf("  NDM_WORKERS_HOST: %s\n", NDM_WORKERS_HOST)

    initWorkers()

    // Wait for Control Plane to be ready
    err = waitForControlPlaneReadyWithIP(cpEndpoints[0])
    if err != nil {
        log.Fatalf("Control Plane readiness check failed: %v", err)
    }

    // Initialize and execute migration
    migration := &EndToEndMigration{
        cpEndpoints:     cpEndpoints,
        workerEndpoints: workerEndpoints,
        migrationLogs:   make([]string, 0),
    }

    if err := migration.Execute(); err != nil {
        migration.logOperation(fmt.Sprintf("Migration failed: %v", err))
        log.Fatalf("Migration failed: %v", err)
    }

    // PROTOCOL_TYPE = Protocol("NFS")
    // CLOUD_ENVIRONMENT = CloudEnvironment("GCP")

    // destinationVolumePath1 := fmt.Sprintf("%s:%s", "10.127.176.21", "/con10-shef-1")

    // fmt.Println(time.Now().Format("2006-01-02 15:04:05"), " - Clearing destination volume for next migration...")
    // err = clearVolume(destinationVolumePath1)
    // if err != nil {
    //     log.Fatalf("failed to clear destination volume: %v", err)
    // }
    // // e.logOperation("✓ Cleared destination volume for next migration")
    // fmt.Println(time.Now().Format("2006-01-02 15:04:05"), " - Destination volume cleared successfully.")


    log.Println("End-to-End Migration Program completed successfully!")
}

