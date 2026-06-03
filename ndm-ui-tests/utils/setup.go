package utils

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"ndm-ui-tests/config"
)

const (
	tokenPath        = "keycloak/realms/datamigrator/protocol/openid-connect/token"
	keycloakUsersURL = "keycloak/admin/realms/datamigrator/users"
	openbaoCredsPath = "v1/secrets/keycloak-secrets/keycloak-creds"
	openbaoKeysFile  = "/opt/datamigrator/openbao/cluster-keys.json"

	clientID       = "datamigrator-client"
	defaultAccount = "753975cb-2f97-4230-b632-6815515a7d0d"

	maxWorkerPollRetries = 30
	pollIntervalSec      = 10
)

// Populated by InitTestEnv and available to test code.
var (
	SetupProjectID      string
	SetupProjectName    string
	SetupAuthToken      string
	SetupWorkerIDs      []string
	SetupSMBWorkerIDs   []string

	kcClientSecret string

	setupHTTPClient = &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
		Timeout: 60 * time.Second,
	}
)

func logSetup(format string, args ...interface{}) {
	fmt.Printf("[setup] "+format+"\n", args...)
}

// cpHost extracts the bare IP/hostname from config.BaseURL.
func cpHost() string {
	h := config.BaseURL
	h = strings.TrimPrefix(h, "https://")
	h = strings.TrimPrefix(h, "http://")
	return strings.TrimSuffix(h, "/")
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

func doRequest(method, rawURL string, body []byte, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(method, rawURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return setupHTTPClient.Do(req)
}

func authHeaders(token string) map[string]string {
	return map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + token,
	}
}

// ─── OpenBao ─────────────────────────────────────────────────────────────────

func getOpenBaoRootToken() (string, error) {
	cfg := SSHConfig{
		Host:     cpHost(),
		Port:     config.CPSSHPort,
		Username: config.CPSSHUsername,
		Password: config.CPSSHPassword,
	}

	output, err := RunScript(cfg, "cat "+openbaoKeysFile)
	if err != nil {
		return "", fmt.Errorf("read OpenBao keys via SSH (%s): %w", cfg.Host, err)
	}

	var keys struct {
		RootToken string `json:"root_token"`
	}
	if err := json.Unmarshal([]byte(output), &keys); err != nil {
		return "", fmt.Errorf("parse cluster-keys.json: %w", err)
	}
	if keys.RootToken == "" {
		return "", fmt.Errorf("root_token is empty in cluster keys")
	}
	return keys.RootToken, nil
}

// ─── Keycloak credentials from OpenBao ───────────────────────────────────────

type keycloakCreds struct {
	AdminUser     string
	AdminPassword string
	ClientSecret  string
}

func getKeycloakCredentials() (keycloakCreds, error) {
	// Fast path: if NDM_KEYCLOAK_CLIENT_SECRET is set directly, skip the
	// OpenBao SSH entirely. Useful when running tests from a machine that
	// cannot SSH into the control plane (e.g. local dev behind VPN/Tailscale).
	if secret := config.KeycloakClientSecret; secret != "" {
		logSetup("Using NDM_KEYCLOAK_CLIENT_SECRET from env (skipping OpenBao SSH)")
		return keycloakCreds{ClientSecret: secret}, nil
	}

	vaultToken, err := getOpenBaoRootToken()
	if err != nil {
		return keycloakCreds{}, err
	}

	reqURL := fmt.Sprintf("https://%s/%s", cpHost(), openbaoCredsPath)
	headers := map[string]string{
		"Content-Type":  "application/x-www-form-urlencoded",
		"X-Vault-Token": vaultToken,
	}

	resp, err := doRequest("GET", reqURL, nil, headers)
	if err != nil {
		return keycloakCreds{}, fmt.Errorf("fetch keycloak creds: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var parsed struct {
		Data struct {
			AdminUser     string `json:"KEYCLOAK_ADMIN_USER"`
			AdminPassword string `json:"KEYCLOAK_ADMIN_PASSWORD"`
			ClientSecret  string `json:"KEYCLOAK_CLIENT_SECRET"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return keycloakCreds{}, fmt.Errorf("parse keycloak creds: %w", err)
	}
	if parsed.Data.ClientSecret == "" {
		return keycloakCreds{}, fmt.Errorf("client secret empty in OpenBao response: %s", string(body))
	}

	return keycloakCreds{
		AdminUser:     parsed.Data.AdminUser,
		AdminPassword: parsed.Data.AdminPassword,
		ClientSecret:  parsed.Data.ClientSecret,
	}, nil
}

// ─── App admin setup via Keycloak Admin API ──────────────────────────────────

// getAdminCLIToken obtains a service-account token for admin-cli.
// This does NOT require user credentials — only the client secret.
func getAdminCLIToken() (string, error) {
	tokenURL := fmt.Sprintf("https://%s/%s", cpHost(), tokenPath)

	data := url.Values{}
	data.Set("client_id", "admin-cli")
	data.Set("client_secret", kcClientSecret)
	data.Set("grant_type", "client_credentials")

	headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	resp, err := doRequest("POST", tokenURL, []byte(data.Encode()), headers)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("admin-cli token failed (%d): %s", resp.StatusCode, body)
	}

	var tok map[string]interface{}
	json.Unmarshal(body, &tok) //nolint:errcheck
	if s, ok := tok["access_token"].(string); ok {
		return s, nil
	}
	return "", fmt.Errorf("access_token not found in response")
}

func fetchUserID(email, adminToken string) (string, error) {
	reqURL := fmt.Sprintf("https://%s/%s?email=%s", cpHost(), keycloakUsersURL, url.QueryEscape(email))
	resp, err := doRequest("GET", reqURL, nil, authHeaders(adminToken))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var users []struct {
		ID string `json:"id"`
	}
	json.Unmarshal(body, &users) //nolint:errcheck
	if len(users) == 0 {
		return "", fmt.Errorf("no user found for email %q", email)
	}
	return users[0].ID, nil
}

func resetUserPassword(userID, adminToken, newPassword string) error {
	reqURL := fmt.Sprintf("https://%s/%s/%s/reset-password", cpHost(), keycloakUsersURL, userID)
	payload, _ := json.Marshal(map[string]interface{}{
		"type":      "password",
		"value":     newPassword,
		"temporary": false,
	})

	resp, err := doRequest("PUT", reqURL, payload, authHeaders(adminToken))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("reset password failed (%d): %s", resp.StatusCode, body)
	}
	return nil
}

func updateUserProfile(userID, adminToken string) error {
	reqURL := fmt.Sprintf("https://%s/%s/%s", cpHost(), keycloakUsersURL, userID)
	payload, _ := json.Marshal(map[string]interface{}{
		"firstName":       "admin",
		"lastName":        "admin",
		"email":           config.Username,
		"requiredActions": []string{},
	})

	resp, err := doRequest("PUT", reqURL, payload, authHeaders(adminToken))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update profile failed (%d): %s", resp.StatusCode, body)
	}
	return nil
}

// setupAppAdmin ensures the admin account is ready for use. It first tries
// to obtain a bearer token with the current credentials. If that succeeds,
// the account is already configured and no Keycloak changes are needed.
// On a fresh CP (first login) the token will fail because of pending
// requiredActions, so we reset the password and update the profile.
func setupAppAdmin() error {
	// Fast path: if we can already get a bearer token, the admin is set up.
	if _, err := getBearerToken(); err == nil {
		logSetup("App admin %s already configured (bearer token OK)", config.Username)
		return nil
	}

	logSetup("Bearer token failed — configuring admin account via Keycloak Admin API...")

	adminToken, err := getAdminCLIToken()
	if err != nil {
		return fmt.Errorf("get admin-cli token: %w", err)
	}

	userID, err := fetchUserID(config.Username, adminToken)
	if err != nil {
		return fmt.Errorf("fetch user ID for %s: %w", config.Username, err)
	}

	// Clear requiredActions first — if the password was already set by a
	// prior run, this alone unblocks the bearer token login.
	if err := updateUserProfile(userID, adminToken); err != nil {
		return fmt.Errorf("update profile: %w", err)
	}

	// Retry bearer token now that requiredActions are cleared.
	if _, err := getBearerToken(); err == nil {
		logSetup("App admin %s configured (profile cleared, bearer token OK)", config.Username)
		return nil
	}

	// Still failing — password must differ from what we want. Reset it.
	if err := resetUserPassword(userID, adminToken, config.Password); err != nil {
		return fmt.Errorf("reset password: %w", err)
	}

	logSetup("App admin %s configured", config.Username)
	return nil
}

// ─── Bearer token ────────────────────────────────────────────────────────────

func getBearerToken() (string, error) {
	tokenURL := fmt.Sprintf("https://%s/%s", cpHost(), tokenPath)

	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", kcClientSecret)
	data.Set("grant_type", "password")
	data.Set("username", config.Username)
	data.Set("password", config.Password)

	headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	resp, err := doRequest("POST", tokenURL, []byte(data.Encode()), headers)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bearer token request failed (%d): %s", resp.StatusCode, body)
	}

	var tok map[string]interface{}
	json.Unmarshal(body, &tok) //nolint:errcheck
	if s, ok := tok["access_token"].(string); ok {
		return s, nil
	}
	return "", fmt.Errorf("access_token not found in token response")
}

// ─── Project ─────────────────────────────────────────────────────────────────

func createProject(authToken string) (string, string, error) {
	name := fmt.Sprintf("ui-test-%d", time.Now().UnixMilli())
	payload, _ := json.Marshal(map[string]string{
		"account_id":          defaultAccount,
		"project_name":        name,
		"project_description": "UI E2E test project (auto-created)",
		"start_date":          time.Now().UTC().Format(time.RFC3339),
	})

	resp, err := doRequest("POST", config.BaseURL+"/api/v1/projects", payload, authHeaders(authToken))
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.Unmarshal(body, &result) //nolint:errcheck
	if result.Data.ID == "" {
		return "", "", fmt.Errorf("project ID not in response: %s", string(body))
	}
	return result.Data.ID, name, nil
}

// ─── Worker registration ────────────────────────────────────────────────────

func workerSSHConfigs() []SSHConfig {
	ips := config.WorkerIPs
	if ips == "" {
		if config.WorkerHost == "" {
			return nil
		}
		ips = config.WorkerHost
	}

	var cfgs []SSHConfig
	for _, ip := range strings.Split(ips, ",") {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			continue
		}
		cfgs = append(cfgs, SSHConfig{
			Host:     ip,
			Port:     config.WorkerPort,
			Username: config.WorkerUsername,
			Password: config.WorkerPassword,
		})
	}
	return cfgs
}

// cleanupWorkerRegistration stops the worker service and removes its config
// so the VM can be re-registered to a new project.
func cleanupWorkerRegistration(cfg SSHConfig) {
	script := fmt.Sprintf(`#!/bin/bash
	set -e 

	SUDO_PASS="%s"

	SERVICE="datamigrator-worker.service"
	ENV_FILE="/opt/datamigrator/conf/worker.env"

	if systemctl is-active --quiet "$SERVICE"; then
		echo "$SUDO_PASS" | sudo -S systemctl stop "$SERVICE"
		echo "$SUDO_PASS" | sudo -S systemctl disable "$SERVICE"
	fi

	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_CONFIG_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_JOB_SERVICE_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_REPORT_SERVICE_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^TEMPORAL_ADDRESS=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^KEYCLOAK_BASE_URL=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_ID=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^WORKER_SECRET=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^TLS_CERT=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^CONTROL_PLANE_IP=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_HOST=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_USERNAME=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_PASSWORD=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_JWT_AUTH_ENABLED=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_GATEWAY_HOST=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^REDIS_GATEWAY_PORT=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^PROJECT_ID=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^OTEL_COLLECTOR_ENDPOINT=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^TEMPORAL_TLS_ENABLED=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^TEMPORAL_TLS_SERVER_NAME=/d' "$ENV_FILE"
	echo "$SUDO_PASS" | sudo -S sed -i '/^TEMPORAL_JWT_ENABLED=/d' "$ENV_FILE"
`, cfg.Password)
	_, _ = RunScript(cfg, script)
}

func registerWorker(projectID, authToken string, cfg SSHConfig) (string, error) {
	cleanupWorkerRegistration(cfg)

	payload, _ := json.Marshal(map[string]string{"projectId": projectID})
	resp, err := doRequest("POST", config.BaseURL+"/api/v1/worker-registration", payload, authHeaders(authToken))
	if err != nil {
		return "", fmt.Errorf("worker registration API: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var reg struct {
		Data struct {
			Items struct {
				WorkerID             string `json:"workerId"`
				WorkerSecret         string `json:"workerSecret"`
				ControlPlaneIP       string `json:"controlPlaneIp"`
				GatewayCACertificate string `json:"gatewayCACertificate"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &reg); err != nil {
		return "", fmt.Errorf("parse registration response: %w\nbody: %s", err, body)
	}

	items := reg.Data.Items
	if items.WorkerID == "" {
		return "", fmt.Errorf("empty workerId in response: %s", string(body))
	}

	tlsCert := items.GatewayCACertificate
	if tlsCert != "" {
		tlsCert = strings.ReplaceAll(tlsCert, "'", "'\\''")
	}
	script := fmt.Sprintf(`
    sudo su -c '
    export WORKER_ID=%s
    export WORKER_SECRET=%s
    export PROJECT_ID=%s
    export CONTROL_PLANE_IP=%s
    export TLS_CERT='%s'
    sh /opt/datamigrator/bin/worker_register.sh
    '
    `, items.WorkerID, items.WorkerSecret, projectID, items.ControlPlaneIP, tlsCert)

	if _, err := RunScript(cfg, script); err != nil {
		return "", fmt.Errorf("worker_register.sh on %s: %w", cfg.Host, err)
	}
	return items.WorkerID, nil
}

// ─── SMB (Windows) Worker registration ──────────────────────────────────────

func smbWorkerSSHConfig() *SSHConfig {
	if config.SMBWorkerHost == "" {
		return nil
	}
	return &SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}
}

func cleanupSMBWorkerRegistration(cfg SSHConfig) {
	psScript := `Start-Process -Wait -FilePath "C:\datamigrator\unins000.exe" -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/LOG=C:\datamigrator_uninstall.log"; if (Test-Path "C:\datamigrator") { Remove-Item -Path "C:\datamigrator" -Recurse -Force }`
	script := fmt.Sprintf(`powershell.exe -Command "%s"`, psScript)
	logSetup("  Cleaning up existing SMB worker on %s", cfg.Host)
	_, _ = RunScript(cfg, script)
}

func registerSMBWorker(projectID, authToken string, cfg SSHConfig) (string, error) {
	cleanupSMBWorkerRegistration(cfg)

	payload, _ := json.Marshal(map[string]string{"projectId": projectID})
	resp, err := doRequest("POST", config.BaseURL+"/api/v1/worker-registration", payload, authHeaders(authToken))
	if err != nil {
		return "", fmt.Errorf("SMB worker registration API: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var reg struct {
		Data struct {
			Items struct {
				WorkerID             string `json:"workerId"`
				WorkerSecret         string `json:"workerSecret"`
				ControlPlaneIP       string `json:"controlPlaneIp"`
				GatewayCACertificate string `json:"gatewayCACertificate"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &reg); err != nil {
		return "", fmt.Errorf("parse SMB registration response: %w\nbody: %s", err, body)
	}

	items := reg.Data.Items
	if items.WorkerID == "" {
		return "", fmt.Errorf("empty workerId in SMB response: %s", string(body))
	}

	tlsCertArg := items.GatewayCACertificate
	if strings.ContainsAny(tlsCertArg, " \t\"") {
		tlsCertArg = `"` + strings.ReplaceAll(tlsCertArg, `"`, `\"`) + `"`
	}
	script := fmt.Sprintf(
		`"%s" /SILENT /WORKERID=%s /WORKERSECRET=%s /CONTROLPLANEIP=%s /PROJECTID=%s /TLSCERT=%s`,
		config.SMBExecutableFilename,
		items.WorkerID,
		items.WorkerSecret,
		items.ControlPlaneIP,
		projectID,
		tlsCertArg,
	)

	if _, err := RunScript(cfg, script); err != nil {
		return "", fmt.Errorf("SMB installer on %s: %w", cfg.Host, err)
	}
	return items.WorkerID, nil
}

func pollWorkersOnline(projectID, authToken string, workerIDs []string) error {
	endpoint := fmt.Sprintf("%s/api/v1/workers?projectId=%s", config.BaseURL, projectID)

	for attempt := 1; attempt <= maxWorkerPollRetries; attempt++ {
		resp, err := doRequest("GET", endpoint, nil, authHeaders(authToken))
		if err != nil {
			logSetup("Worker status request failed (attempt %d): %v", attempt, err)
			time.Sleep(time.Duration(pollIntervalSec) * time.Second)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result struct {
			Data struct {
				Items []struct {
					WorkerID string `json:"workerId"`
					Status   string `json:"status"`
				} `json:"items"`
			} `json:"data"`
		}
		json.Unmarshal(body, &result) //nolint:errcheck

		statusMap := make(map[string]string)
		for _, item := range result.Data.Items {
			statusMap[item.WorkerID] = item.Status
		}

		online := 0
		for _, wid := range workerIDs {
			if statusMap[wid] == "Online" {
				online++
			} else {
				logSetup("  worker %s: %s (attempt %d/%d)", wid, statusMap[wid], attempt, maxWorkerPollRetries)
			}
		}
		if online == len(workerIDs) {
			logSetup("All %d workers are Online", online)
			return nil
		}

		time.Sleep(time.Duration(pollIntervalSec) * time.Second)
	}
	return fmt.Errorf("timeout: workers not online after %d attempts (%ds)",
		maxWorkerPollRetries, maxWorkerPollRetries*pollIntervalSec)
}

// ─── Public API ──────────────────────────────────────────────────────────────

// InitTestEnv performs all pre-test setup: fetches secrets, configures the
// admin account, creates a project, and registers workers. It mirrors
// ndm-api-tests/utils/setup.go InitTestEnv().
func InitTestEnv() error {
	logSetup("Initializing test environment...")
	logSetup("Control plane: %s", cpHost())

	// Skip full setup for local testing against an existing CP with
	// pre-configured projects and workers.
	if os.Getenv("NDM_SKIP_SETUP") == "true" {
		logSetup("NDM_SKIP_SETUP=true — skipping project creation and worker registration")
		logSetup("Using existing project and workers on the CP")
		return nil
	}

	// 1. Keycloak credentials from OpenBao
	logSetup("Step 1/6: Retrieving Keycloak credentials from OpenBao...")
	creds, err := getKeycloakCredentials()
	if err != nil {
		return fmt.Errorf("get keycloak credentials: %w", err)
	}
	kcClientSecret = creds.ClientSecret
	logSetup("  Keycloak admin user: %s", creds.AdminUser)

	// 2. Set up app admin (reset password, update profile, clear requiredActions)
	logSetup("Step 2/6: Configuring app admin account...")
	if err := setupAppAdmin(); err != nil {
		return fmt.Errorf("setup app admin: %w", err)
	}

	// 3. Get bearer token for API calls
	logSetup("Step 3/6: Acquiring bearer token...")
	SetupAuthToken, err = getBearerToken()
	if err != nil {
		return fmt.Errorf("get bearer token: %w", err)
	}
	logSetup("  Bearer token acquired")

	// 4. Create project
	logSetup("Step 4/6: Creating project...")
	SetupProjectID, SetupProjectName, err = createProject(SetupAuthToken)
	if err != nil {
		return fmt.Errorf("create project: %w", err)
	}
	logSetup("  Project: %s (ID: %s)", SetupProjectName, SetupProjectID)

	// 5. Register NFS (Linux) workers
	workerCfgs := workerSSHConfigs()
	needed := config.MinWorkers
	if needed == 0 {
		needed = 1
	}
	if needed > len(workerCfgs) {
		return fmt.Errorf("need %d workers but only %d worker IPs configured", needed, len(workerCfgs))
	}

	logSetup("Step 5/7: Registering %d NFS worker(s)...", needed)
	SetupWorkerIDs = nil
	for i := 0; i < needed; i++ {
		cfg := workerCfgs[i]
		logSetup("  Registering NFS worker %d/%d (%s)...", i+1, needed, cfg.Host)
		wid, err := registerWorker(SetupProjectID, SetupAuthToken, cfg)
		if err != nil {
			return fmt.Errorf("register worker %s: %w", cfg.Host, err)
		}
		logSetup("  NFS worker registered: %s → ID %s", cfg.Host, wid)
		SetupWorkerIDs = append(SetupWorkerIDs, wid)
	}

	// 6. Register SMB (Windows) worker if configured
	SetupSMBWorkerIDs = nil
	smbCfg := smbWorkerSSHConfig()
	if smbCfg != nil {
		logSetup("Step 6/7: Registering SMB (Windows) worker (%s)...", smbCfg.Host)
		wid, err := registerSMBWorker(SetupProjectID, SetupAuthToken, *smbCfg)
		if err != nil {
			logSetup("  WARNING: SMB worker registration failed: %v", err)
			logSetup("  SMB discovery tests will see 0 compatible workers")
		} else {
			logSetup("  SMB worker registered: %s → ID %s", smbCfg.Host, wid)
			SetupSMBWorkerIDs = append(SetupSMBWorkerIDs, wid)
		}
	} else {
		logSetup("Step 6/7: No SMB worker configured (NDM_SMB_WORKER_HOST not set) — skipping")
	}

	// 7. Wait for all workers to come online
	allWorkerIDs := append(SetupWorkerIDs, SetupSMBWorkerIDs...)
	logSetup("Step 7/7: Waiting for %d worker(s) to come online...", len(allWorkerIDs))
	if err := pollWorkersOnline(SetupProjectID, SetupAuthToken, allWorkerIDs); err != nil {
		return fmt.Errorf("poll workers: %w", err)
	}

	// 8. Domain-join SMB worker if configured (required for AD/SMB operations)
	if len(SetupSMBWorkerIDs) > 0 {
		if err := EnsureSMBWorkerDomainJoined(); err != nil {
			return fmt.Errorf("SMB worker domain join: %w", err)
		}
	}

	logSetup("═══════════════════════════════════════════════════════════")
	logSetup("Test environment ready")
	logSetup("  Project     : %s (%s)", SetupProjectName, SetupProjectID)
	logSetup("  NFS workers : %d online", len(SetupWorkerIDs))
	logSetup("  SMB workers : %d online", len(SetupSMBWorkerIDs))
	logSetup("═══════════════════════════════════════════════════════════")
	return nil
}

// WaitForExportPathInFileServer repeatedly calls NDM's file-server refresh
// endpoint and polls the export-path list until exportPath appears, or until
// the timeout is reached (60 attempts × 5 s = 5 minutes max).
//
// This mirrors the TC-001 API-test pattern: GetExportPathID triggers a refresh
// on every poll so NDM keeps re-querying the NFS host until the ANF clone's
// export propagates through the NFS server.
//
// Call this after createFreshFileServer and before opening Bulk Discover so
// that the cloned volume path is guaranteed to be listed in the UI table.
func WaitForExportPathInFileServer(fsID, exportPath string) error {
	const maxRetries = 60
	const pollInterval = 5 * time.Second

	refreshURL := fmt.Sprintf("%s/api/v1/servers/refresh/%s", config.BaseURL, fsID)
	getURL := fmt.Sprintf("%s/api/v1/servers/%s", config.BaseURL, fsID)

	// Normalise the expected path once: strip leading slash and lower-case.
	normalise := func(p string) string {
		return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(p), "/"))
	}
	wantNorm := normalise(exportPath)

	logSetup("Waiting for export path %q to appear in file server %s (max %d attempts)…",
		exportPath, fsID, maxRetries)

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Trigger NDM to re-query the NFS host for its current export list.
		if resp, err := doRequest("GET", refreshURL, nil, authHeaders(SetupAuthToken)); err == nil {
			resp.Body.Close()
		}

		// First attempt: wait 10 s for the initial scan to complete;
		// subsequent attempts: 5 s (same rhythm as the API-tests).
		if attempt == 1 {
			time.Sleep(10 * time.Second)
		} else {
			time.Sleep(pollInterval)
		}

		// Fetch the file server detail and inspect its volume list.
		resp, err := doRequest("GET", getURL, nil, authHeaders(SetupAuthToken))
		if err != nil {
			logSetup("  attempt %d/%d: GET file server failed: %v", attempt, maxRetries, err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var detail struct {
			Data struct {
				Items struct {
					FileServers []struct {
						Volumes []struct {
							VolumePath string `json:"volumePath"`
						} `json:"volumes"`
					} `json:"fileServers"`
				} `json:"items"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &detail); err != nil {
			logSetup("  attempt %d/%d: parse response failed: %v", attempt, maxRetries, err)
			continue
		}

		for _, fs := range detail.Data.Items.FileServers {
			for _, v := range fs.Volumes {
				if normalise(v.VolumePath) == wantNorm {
					logSetup("Export path %q appeared in file server %s on attempt %d",
						exportPath, fsID, attempt)
					return nil
				}
			}
		}

		logSetup("  attempt %d/%d: export path %q not yet visible (%d volumes found)",
			attempt, maxRetries, exportPath, countVolumes(detail.Data.Items.FileServers))
	}

	return fmt.Errorf("export path %q not visible in file server %s after %d attempts (%s)",
		exportPath, fsID, maxRetries, (maxRetries*pollInterval + 10*time.Second).String())
}

// countVolumes is a small helper to count total volumes across all file server
// entries in the response (used only for log messages).
func countVolumes(fsList []struct {
	Volumes []struct {
		VolumePath string `json:"volumePath"`
	} `json:"volumes"`
}) int {
	n := 0
	for _, fs := range fsList {
		n += len(fs.Volumes)
	}
	return n
}

// CleanupTestEnv detaches workers so they can be reused by subsequent runs.
func CleanupTestEnv() {
	if SetupProjectID == "" {
		return
	}
	logSetup("Cleaning up test environment (project %s)...", SetupProjectName)

	cfgs := workerSSHConfigs()
	for i := 0; i < len(SetupWorkerIDs) && i < len(cfgs); i++ {
		logSetup("  Detaching NFS worker %s (%s)...", SetupWorkerIDs[i], cfgs[i].Host)
		cleanupWorkerRegistration(cfgs[i])
	}

	if smbCfg := smbWorkerSSHConfig(); smbCfg != nil && len(SetupSMBWorkerIDs) > 0 {
		logSetup("  Detaching SMB worker %s (%s)...", SetupSMBWorkerIDs[0], smbCfg.Host)
		cleanupSMBWorkerRegistration(*smbCfg)
	}

	logSetup("Cleanup complete")
}
