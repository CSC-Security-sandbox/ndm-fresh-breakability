package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	. "ndm-api-tests/utils"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type ScaleTestConfig struct {
	ProjectID            string
	Zone                 string
	CPImageName          string
	WorkerImageName      string
	CPInstanceName       string
	WorkerInstanceNames  []string
	WorkerCount          int
	CPPrivateKeyPath     string
	WorkerPrivateKeyPath map[string]string
	// New fields for VM info
	VMInfos  []VMInfo
	CPVMName string
	CPZone   string
}

// getLatestImage fetches the latest image matching a filter from GCP
func getLatestImage(projectID, filter string) (string, error) {
	cmd := fmt.Sprintf(`gcloud compute images list --project=%s --filter="name~'%s'" --format="table(name,creationTimestamp)" --sort-by=~creationTimestamp --limit=1 --format="value(name)"`, projectID, filter)

	out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get latest image: %v\nCommand: %s\nOutput: %s", err, cmd, string(out))
	}

	image := strings.TrimSpace(string(out))
	if image == "" {
		return "", fmt.Errorf("no image found matching filter: %s", filter)
	}

	log.Printf("Found latest image for filter '%s': %s", filter, image)
	return image, nil
}

func getKeyCloakAccessToken(userN, pass, cpIp string) (string, error) {
	if strings.TrimSpace(userN) == "" || strings.TrimSpace(pass) == "" {
		return "", fmt.Errorf("username and password must be provided")
	}

	if cpIp == "" || CLIENT_ID == "" || GRANT_TYPE == "" {
		return "", fmt.Errorf("one or more required environment variables are not set (KEYCLOAK_IP, CLIENT_ID, GRANT_TYPE)")
	}

	tokenUrl := fmt.Sprintf("https://%s/%s", cpIp, KEYCLOAK_TOKEN_URL)

	data := url.Values{}
	data.Set("client_id", KEYCLOAK_CLIENT_ID)
	data.Set("username", userN)
	data.Set("password", pass)
	data.Set("grant_type", GRANT_TYPE)
	requestBody := data.Encode()

	headers := GetHeaders("", ContentTypeForm)
	resp, err := SendAPIRequest("POST", tokenUrl, []byte(requestBody), headers)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading response: %v", err)
			return "", err
		}
		var jsonResponse map[string]interface{}
		if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
			log.Printf("Error parsing JSON response: %v", err)
			return "", err
		}
		accessToken, ok := jsonResponse["access_token"].(string)
		if !ok {
			log.Printf("access_token not found in response")
			return "", fmt.Errorf("access_token not found in response")
		}
		return accessToken, nil
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
		return "", fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
	}
}
func fetchUserID(email, accessToken, cpIp string) (string, error) {
	if cpIp == "" {
		return "", fmt.Errorf("cpIp must be provided")
	}
	url := fmt.Sprintf("https://%s/%s?email=%s", cpIp, KEYCLOAK_BASE_URL, email)
	headers := GetHeaders(accessToken, ContentTypeJSON)
	resp, err := SendAPIRequest("GET", url, nil, headers)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("non-200 response: %d", resp.StatusCode)
	}
	var users []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(bodyBytes, &users); err != nil {
		return "", err
	}
	if len(users) == 0 {
		return "", fmt.Errorf("no user found")
	}
	return users[0].ID, nil
}
func resetUserPassword(userID, accessToken, cpIp, newPassword string) error {
	if cpIp == "" {
		return fmt.Errorf("cpIp must be provided")
	}
	url := fmt.Sprintf("https://%s/%s/%s/reset-password", cpIp, KEYCLOAK_BASE_URL, userID)

	var err error
	PASSWORD, err = GenerateNewPassword(10)
	if err != nil {
		return fmt.Errorf("failed to generate new password: %w", err)
	}

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
func updateUserProfile(userID, cpIp, accessToken string) error {
	if cpIp == "" {
		return fmt.Errorf("environment variable cpIp not set")
	}
	url := fmt.Sprintf("https://%s/%s/%s", cpIp, KEYCLOAK_BASE_URL, userID)
	profile := map[string]interface{}{
		"firstName":       "admin",
		"lastName":        "admin",
		"email":           "admin@datamigrator.local",
		"requiredActions": []string{},
	}
	bodyBytes, err := json.Marshal(profile)
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
func updateAppAdmin(keycloakUser, keycloakPassword, username, cpIp, password string) error {
	keycloakAuthToken, err := getKeyCloakAccessToken(keycloakUser, keycloakPassword, cpIp)
	if err != nil {
		return fmt.Errorf("error getting Keycloak access token: %v", err)
	}

	userID, err := fetchUserID(username, keycloakAuthToken, cpIp)
	if err != nil {
		return fmt.Errorf("error fetching user ID for '%s': %v", username, err)
	}

	err = resetUserPassword(userID, keycloakAuthToken, cpIp, password)
	if err != nil {
		return fmt.Errorf("error resetting password for '%s': %v", username, err)
	}

	err = updateUserProfile(userID, cpIp, keycloakAuthToken)
	if err != nil {
		return fmt.Errorf("error updating profile for '%s': %v", username, err)
	}

	log.Printf("Successfully updated app admin for '%s'", username)
	log.Printf("PASSWORD: %s", PASSWORD)
	return nil
}

func createVMWithGcloud(config *ScaleTestConfig, name, machineType, image string, isControlPlane bool) error {
	zone := config.Zone
	project := config.ProjectID

	// Generate SSH key pair
	privateKey, publicKey, err := generateSSHKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate SSH key pair: %v", err)
	}

	// Save private key for later use
	privateKeyPath, err := saveSSHKey(privateKey, fmt.Sprintf("%s_key", name))
	if err != nil {
		return fmt.Errorf("failed to save private key: %v", err)
	}

	// Use your actual Google account username (GCP auto-creates this)
	// GCP converts email to username: am56663@netapp.com -> am56663_netapp_com
	sshUser := "ndmuser"

	// Format SSH key for GCP metadata
	publicKeyTrimmed := strings.TrimSpace(publicKey)
	sshKeyMetadata := fmt.Sprintf("%s:%s %s@gcp", sshUser, publicKeyTrimmed, sshUser)

	// Minimal startup script - let GCP handle user creation
	startupScript := `#!/bin/bash
exec > /var/log/startup-script.log 2>&1
echo "Starting VM configuration at $(date)..."

# Just ensure SSH service is running - GCP handles the rest
systemctl enable ssh
systemctl start ssh

# Verify SSH service
echo "SSH service status:"
systemctl status ssh --no-pager

echo "Users on system:"
cat /etc/passwd | grep -E "(am56663|ndm)" || echo "No custom users found"

echo "VM startup completed successfully at $(date)"`

	cmd := fmt.Sprintf(`gcloud compute instances create %s \
        --project=%s \
        --zone=%s \
        --machine-type=%s \
        --network-interface=network=appmicro-vpc1,subnet=appmicro-vpc-subnet-01,no-address \
        --image=%s \
        --tags=http-server \
        --metadata=ssh-keys=%q,startup-script=%q`,
		name, project, zone, machineType, image, sshKeyMetadata, startupScript)

	log.Printf("Creating %s: %s", map[bool]string{true: "Control Plane", false: "Worker"}[isControlPlane], name)
	log.Printf("SSH user: %s", sshUser)
	log.Printf("Private key saved to: %s", privateKeyPath)

	out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to create VM %s: %v\nOutput: %s", name, err, string(out))
	}

	log.Printf("VM created successfully: %s", name)

	// Store the private key path for later use in SSH connections
	if isControlPlane {
		config.CPPrivateKeyPath = privateKeyPath
	} else {
		// Initialize the map if it's nil
		if config.WorkerPrivateKeyPath == nil {
			config.WorkerPrivateKeyPath = make(map[string]string)
		}
		config.WorkerPrivateKeyPath[name] = privateKeyPath
		log.Printf("Stored private key for worker %s: %s", name, privateKeyPath)
	}

	return nil
}

// sshRunScriptWithKey runs a script on a remote host using SSH key authentication
func sshRunScriptWithKey(host, username, privateKeyPath, script string) (string, error) {
	// Read the private key
	privateKeyBytes, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return "", fmt.Errorf("failed to read private key: %v", err)
	}

	// Parse the private key
	signer, err := ssh.ParsePrivateKey(privateKeyBytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %v", err)
	}

	// Create SSH client config
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	// Connect to the remote host
	client, err := ssh.Dial("tcp", host+":22", config)
	if err != nil {
		return "", fmt.Errorf("failed to dial: %v", err)
	}
	defer client.Close()

	// Create a session
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %v", err)
	}
	defer session.Close()

	// Run the script
	output, err := session.CombinedOutput(script)
	if err != nil {
		return "", fmt.Errorf("failed to run script: %v\nOutput: %s", err, string(output))
	}

	return string(output), nil
}

// waitForVMsReady waits for all VMs to be in RUNNING state
func waitForVMsReady(projectID, zone string, vmNames []string) error {
	log.Printf("Waiting for %d VMs to be ready...", len(vmNames))

	maxAttempts := 30
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		allReady := true

		for _, vmName := range vmNames {
			cmd := fmt.Sprintf("gcloud compute instances describe %s --project=%s --zone=%s --format='get(status)'",
				vmName, projectID, zone)

			out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
			if err != nil {
				log.Printf("Failed to check status of %s: %v", vmName, err)
				allReady = false
				continue
			}

			status := strings.TrimSpace(string(out))
			if status != "RUNNING" {
				log.Printf("VM %s status: %s (waiting...)", vmName, status)
				allReady = false
			}
		}

		if allReady {
			log.Printf("All VMs are ready after %d attempts", attempt)
			return nil
		}

		if attempt < maxAttempts {
			log.Printf("Attempt %d/%d - waiting 10s before retry...", attempt, maxAttempts)
			time.Sleep(10 * time.Second)
		}
	}

	return fmt.Errorf("VMs not ready after %d attempts", maxAttempts)
}

// getVMInternalIP gets the internal IP of a VM
func getVMInternalIP(projectID, zone, vmName string) (string, error) {
	cmd := fmt.Sprintf("gcloud compute instances describe %s --project=%s --zone=%s --format='get(networkInterfaces[0].networkIP)'",
		vmName, projectID, zone)

	out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get IP for %s: %v", vmName, err)
	}

	ip := strings.TrimSpace(string(out))
	if ip == "" {
		return "", fmt.Errorf("no internal IP found for %s", vmName)
	}

	return ip, nil
}

// waitForControlPlaneReady waits for control plane to respond with HTTP 200
func waitForControlPlaneReady(cpIP string) error {
	log.Printf("Waiting for control plane at %s to be ready (this can take ~30 minutes)...", cpIP)

	maxAttempts := 180 // 30 minutes with 10-second intervals
	healthURL := fmt.Sprintf("http://%s/health", cpIP)

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// resp, err := http.Get(healthURL)
		resp, err := SendAPIRequest("GET", healthURL, nil, nil)
		if err != nil {
			log.Printf("HTTP request failed: %v", err)
		} else {
			log.Printf("Received response - Status Code: %d", resp.StatusCode)
			if resp.StatusCode == 200 {
				resp.Body.Close()
				log.Printf("Control plane is ready after %d attempts (%.1f minutes)",
					attempt, float64(attempt*10)/60.0)
				log.Printf("Waiting 5 minutes for the control plane to stabilize...")
				time.Sleep(5 * time.Minute)
				return nil
			}
			resp.Body.Close()
		}

		if attempt%6 == 0 { // Log every minute
			log.Printf("Still waiting for CP... attempt %d/%d (%.1f minutes elapsed)",
				attempt, maxAttempts, float64(attempt*10)/60.0)
		}

		if attempt < maxAttempts {
			time.Sleep(10 * time.Second)
		}
	}

	return fmt.Errorf("control plane not ready after %d attempts (30 minutes)", maxAttempts)
}

func attachWorkers(authToken string, projectId string, cpIp string, workerIP string, workerName string, config *ScaleTestConfig) (string, error) {
	fullURL := "http://" + cpIp + "/api/v1/worker-registration"
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
	log.Print(resp)
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %v", err)
	}

	log.Printf("Worker registration response: %s", string(bodyBytes))

	// Reset the body for CreateWorkerScript to use
	resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	script, workerId, err := CreateWorkerScript(resp, projectId)
	log.Print(script)
	if err != nil {
		return "", err
	}
	log.Printf("For worker %s registration script: %s", workerId, script)

	output, err := sshRunScriptWithKeyOrGcloud(workerIP, "ndmuser", config.WorkerPrivateKeyPath[workerName], script, workerName, config)
	if err != nil {
		return workerId, err
	}
	log.Printf("Worker %s attached successfully with output: %s", workerId, output)

	// Implementation for attaching workers to the control plane
	return workerId, nil
}

// getOpenBaoRootToken reads the JSON file from the remote host, parses it, and returns the root token.
func getOpenBaoRootToken(config *ScaleTestConfig, cpIP string) (string, error) {
	type ClusterKeys struct {
		RootToken string `json:"root_token"`
	}

	log.Printf("Getting OpenBao root token from control plane at %s...", cpIP)

	// Use the control plane's private key for SSH
	script := "cat /opt/datamigrator/openbao/cluster-keys.json"

	// Use the dynamic CP VM name from config
	if config.CPVMName == "" {
		return "", fmt.Errorf("control plane VM name not available from Terraform")
	}

	output, err := sshRunScriptWithKeyOrGcloud(cpIP, "ndmuser", config.CPPrivateKeyPath, script, config.CPVMName, config)
	if err != nil {
		return "", fmt.Errorf("failed to read cluster keys file from CP: %w", err)
	}

	var keys ClusterKeys
	if err := json.Unmarshal([]byte(output), &keys); err != nil {
		return "", fmt.Errorf("failed to parse JSON: %w", err)
	}

	if keys.RootToken == "" {
		return "", fmt.Errorf("root token not found in JSON")
	}

	log.Printf("OpenBao root token retrieved successfully")
	return keys.RootToken, nil
}
func debugVMStatus(config *ScaleTestConfig, vmName string) {
	log.Printf("Debugging VM %s status...", vmName)

	// Get the correct zone for this VM
	vmZone := getZoneForVM(vmName, config)

	// Check VM status
	cmd := fmt.Sprintf(`gcloud compute instances describe %s --project=%s --zone=%s --format="get(status,networkInterfaces[0].networkIP)"`,
		vmName, config.ProjectID, vmZone)

	out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		log.Printf("Failed to get VM status: %v", err)
		return
	}

	log.Printf("VM %s status: %s", vmName, strings.TrimSpace(string(out)))

	// Try to connect via gcloud SSH to see what's happening
	cmd = fmt.Sprintf(`gcloud compute ssh %s --project=%s --zone=%s --command="echo 'GCloud SSH works'; whoami; systemctl status ssh" --ssh-flag="-o ConnectTimeout=10"`,
		vmName, config.ProjectID, vmZone)

	out, err = exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		log.Printf("GCloud SSH failed: %v", err)
	} else {
		log.Printf("GCloud SSH output:\n%s", string(out))
	}
}

type keycloakCredentials struct {
	adminUser     string
	adminPassword string
	clientSecret  string
}

// GetKeycloakAdminCredentials returns KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD.
func getKeyCloakAdminCredentials(config *ScaleTestConfig, cpIP string) (keycloakCredentials, error) {
	token, err := getOpenBaoRootToken(config, cpIP)
	if err != nil {
		return keycloakCredentials{}, fmt.Errorf("failed to get OpenBao root token: %w", err)
	}

	if cpIP == "" {
		return keycloakCredentials{}, fmt.Errorf("environment variable KEYCLOAK_IP not set")
	}

	url := fmt.Sprintf("https://%s/%s", cpIP, KEYCLOAK_CREDENTIALS_URL)
	headers := getOpenbaoHeaders(token)
	resp, err := SendAPIRequest("GET", url, nil, headers)
	if err != nil {
		return keycloakCredentials{}, fmt.Errorf("failed to execute HTTP request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return keycloakCredentials{}, fmt.Errorf("failed to read response body: %w", err)
	}

	type keycloakResponse struct {
		Data struct {
			AdminUser     string `json:"KEYCLOAK_ADMIN_USER"`
			AdminPassword string `json:"KEYCLOAK_ADMIN_PASSWORD"`
			ClientSecret  string `json:"KEYCLOAK_CLIENT_SECRET"`
		} `json:"data"`
	}

	var kcResp keycloakResponse
	err = json.Unmarshal(bodyBytes, &kcResp)
	if err != nil {
		return keycloakCredentials{}, fmt.Errorf("failed to parse JSON response: %w", err)
	}

	if kcResp.Data.AdminUser == "" && kcResp.Data.AdminPassword == "" && kcResp.Data.ClientSecret == "" {
		return keycloakCredentials{}, fmt.Errorf("keycloak credentials not found in response: %s", string(bodyBytes))
	}

	creds := keycloakCredentials{
		adminUser:     kcResp.Data.AdminUser,
		adminPassword: kcResp.Data.AdminPassword,
		clientSecret:  kcResp.Data.ClientSecret,
	}
	log.Printf("Keycloak Admin User: %s", creds.adminUser)

	return creds, nil
}

// getBearerToken retrieves a bearer token using provided credentials or environment variables.
func getBearerToken(userN, pass, clientSecret, cpIP string) (string, string, error) {
	tokenUrl := fmt.Sprintf("https://%s/%s", cpIP, "keycloak/realms/datamigrator/protocol/openid-connect/token")
	defaultUsername := "admin@datamigrator.local"
	defaultPassword := PASSWORD
	// defaultUsername := "am56663@netapp.com"
	// defaultPassword := "Welcome@1234"

	username := strings.TrimSpace(userN)
	if username == "" {
		username = strings.TrimSpace(defaultUsername)
	}
	password := strings.TrimSpace(pass)
	if password == "" {
		password = strings.TrimSpace(defaultPassword)
	}
	data := url.Values{}
	data.Set("client_id", CLIENT_ID)
	data.Set("client_secret", clientSecret)
	data.Set("grant_type", GRANT_TYPE)
	data.Set("username", username)
	data.Set("password", password)
	requestBody := data.Encode()

	headers := GetHeaders("", ContentTypeForm)
	resp, err := SendAPIRequest("POST", tokenUrl, []byte(requestBody), headers)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading response: %v", err)
			return "", "", err
		}
		var jsonResponse map[string]interface{}
		if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
			log.Printf("Error parsing JSON response: %v", err)
			return "", "", err
		}
		accessToken, ok := jsonResponse["access_token"].(string)
		if !ok {
			log.Printf("access_token not found in response")
			return "", "", err
		}
		log.Printf("Access Token: Fetched")
		refreshToken, ok := jsonResponse["refresh_token"].(string)
		if !ok {
			log.Printf("refresh_token not found in response")
			return "", "", err
		}
		log.Printf("Refresh Token: Fetched")
		return accessToken, refreshToken, nil
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
		return "", "", fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
	}
}

func getOpenbaoHeaders(token string) map[string]string {

	return map[string]string{
		"Content-Type":  ContentTypeForm,
		"X-Vault-Token": token,
		// "X-Vault-Namespace": "datamigrator",
	}
}

func createProject(authToken string, accountId, cpIp string) (string, error) {
	fullURL := "http://" + cpIp + "/api/v1/projects"
	data := map[string]string{
		"account_id":          accountId,
		"project_name":        AutoGenerateProjectName("test"),
		"project_description": "Project For Automation testing",
		"start_date":          time.Now().UTC().Format(time.RFC3339),
	}
	reqBody, err := json.Marshal(data)
	if err != nil {
		log.Printf("error while marshaling request body: %v", err)
	}
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("POST", fullURL, reqBody, headers)
	if err != nil {
		log.Printf("error while sending API request: %v", err)
		return "", err
	}
	defer resp.Body.Close()

	var jsonResponse map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&jsonResponse); err != nil {
		log.Printf("error while decoding response body: %v", err)
		return "", err
	}

	dataMap, ok := jsonResponse["data"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("data not found in response in createProject")
	}
	projectID, ok := dataMap["id"].(string)
	if !ok {
		return "", fmt.Errorf("id not found in response in createProject")
	}

	// Store the project ID globally.
	ProjectID = projectID

	return ProjectID, nil
}

// generateSSHKeyPair generates an SSH key pair and returns private key, public key, and error
func generateSSHKeyPair() (string, string, error) {
	// Generate RSA private key
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", "", err
	}

	// Convert private key to PEM format
	privateKeyPEM := &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}
	privateKeyBytes := pem.EncodeToMemory(privateKeyPEM)

	// Generate public key
	publicKey, err := ssh.NewPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", "", err
	}

	// Format public key for SSH
	publicKeyString := string(ssh.MarshalAuthorizedKey(publicKey))

	return string(privateKeyBytes), publicKeyString, nil
}

// saveSSHKey saves SSH key to file and returns the file path
func saveSSHKey(keyContent string, filename string) (string, error) {
	// Create temp directory if it doesn't exist
	tempDir := "/tmp/ndm-ssh-keys"
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		return "", err
	}

	keyPath := fmt.Sprintf("%s/%s", tempDir, filename)
	err := os.WriteFile(keyPath, []byte(keyContent), 0600)
	if err != nil {
		return "", err
	}

	return keyPath, nil
}

// create GCNV volume
func createGCNVVolume(storagePoolName, projectID, size, volumeName, ShareName string) []string {
	// Ensure gcloud beta components are installed
	log.Printf("Ensuring gcloud beta components are installed...")
	installCmd := "gcloud components install beta --quiet"
	installOut, err := exec.Command("bash", "-c", installCmd).CombinedOutput()
	if err != nil {
		log.Printf("Warning: Failed to install beta components: %v\nOutput: %s", err, string(installOut))
	} else {
		log.Printf("Beta components installation completed")
	}
	exportPolicy := "allowed-clients=0.0.0.0/0,access-type=READ_WRITE,nfsv3=true,has-root-access=true"
	// Create the volume
	cmd := fmt.Sprintf(`gcloud beta netapp volumes create %s \
    --location=us-east4 \
    --storage-pool=%s \
    --capacity=%s \
    --protocols=nfsv3 \
    --share-name=%s \
	--export-policy='%s' \
    --project=%s \
    --format="get(mountOptions[0].export,mountOptions[0].exportFull,state)"`,
		volumeName,
		storagePoolName,
		size,
		ShareName,
		exportPolicy,
		projectID)
	log.Printf("Creating GCNV volume: %s in storage pool: %s", volumeName, storagePoolName)
	out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		log.Printf("Failed to create GCNV volume %s: %v\nOutput: %s", volumeName, err, string(out))
		return nil
	}
	return strings.Fields(strings.TrimSpace(string(out)))
}
func deployInfrastructureWithTerraform(config *ScaleTestConfig) (string, []string, []string, error) {
	log.Println("🚀 Deploying infrastructure using Terraform...")

	terraformDir := "/Users/am56663/Desktop/ndm/ndm/app-deployment/terraform/gcp"

	// Create automated input for the run.sh script
	input := fmt.Sprintf("ndm-scale-auto\n1\n%d\ne2-custom-8-32768\n%s\ne2-custom-4-16384\n%s\nus-east1\n",
		config.WorkerCount,
		config.CPImageName,
		config.WorkerImageName,
	)

	// Run the terraform script with automated input
	cmd := exec.Command("bash", "./run.sh")
	cmd.Dir = terraformDir
	cmd.Stdin = strings.NewReader(input)

	// Capture both stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	log.Printf("Running terraform deployment...")
	err := cmd.Run()
	if err != nil {
		return "", nil, nil, fmt.Errorf("terraform deployment failed: %v\nStdout: %s\nStderr: %s",
			err, stdout.String(), stderr.String())
	}

	log.Printf("✅ Terraform deployment completed successfully")

	// Parse IPs and VM names from terraform output
	cpIP, workerIPs, vmNames, err := getTerraformOutputs(terraformDir)
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to get terraform outputs: %v", err)
	}

	return cpIP, workerIPs, vmNames, nil
}

// Get terraform outputs and VM names
func getTerraformOutputs(terraformDir string) (string, []string, []string, error) {
	log.Println("📋 Getting IP addresses and VM names from Terraform...")

	// Get control plane IP
	cmd := exec.Command("terraform", "output", "-json", "control_plane_internal_ips")
	cmd.Dir = terraformDir
	cpOutput, err := cmd.CombinedOutput()
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to get CP IP: %v\nOutput: %s", err, string(cpOutput))
	}

	var cpIPs []string
	if err := json.Unmarshal(cpOutput, &cpIPs); err != nil {
		return "", nil, nil, fmt.Errorf("failed to parse CP IPs: %v", err)
	}

	if len(cpIPs) == 0 {
		return "", nil, nil, fmt.Errorf("no control plane IPs found")
	}

	// Get worker IPs
	cmd = exec.Command("terraform", "output", "-json", "worker_internal_ips")
	cmd.Dir = terraformDir
	workerOutput, err := cmd.CombinedOutput()
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to get worker IPs: %v\nOutput: %s", err, string(workerOutput))
	}

	var workerIPs []string
	if err := json.Unmarshal(workerOutput, &workerIPs); err != nil {
		return "", nil, nil, fmt.Errorf("failed to parse worker IPs: %v", err)
	}

	// Get VM names from terraform state
	vmInfos, err := getVMInfoFromTerraform(terraformDir)
	var vmNames []string
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to get VM names from terraform: %v", err)
	}

	// Extract just the names from VM info
	for _, vmInfo := range vmInfos {
		vmNames = append(vmNames, vmInfo.Name)
	}

	log.Printf("✅ Control Plane IP: %s", cpIPs[0])
	log.Printf("✅ Worker IPs: %v", workerIPs)
	log.Printf("✅ VM Names: %v", vmNames)

	return cpIPs[0], workerIPs, vmNames, nil
}

// VMInfo represents VM information from Terraform
type VMInfo struct {
	Name string
	Zone string
}

// Get VM names and zones from terraform state
func getVMInfoFromTerraform(terraformDir string) ([]VMInfo, error) {
	cmd := exec.Command("terraform", "show", "-json")
	cmd.Dir = terraformDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to get terraform state: %v", err)
	}

	var state struct {
		Values struct {
			RootModule struct {
				Resources []struct {
					Type   string `json:"type"`
					Values struct {
						Name string `json:"name"`
						Zone string `json:"zone"`
					} `json:"values"`
				} `json:"resources"`
			} `json:"root_module"`
		} `json:"values"`
	}

	if err := json.Unmarshal(output, &state); err != nil {
		return nil, fmt.Errorf("failed to parse terraform state: %v", err)
	}

	var vmInfos []VMInfo
	for _, resource := range state.Values.RootModule.Resources {
		if resource.Type == "google_compute_instance" {
			vmInfos = append(vmInfos, VMInfo{
				Name: resource.Values.Name,
				Zone: resource.Values.Zone,
			})
		}
	}

	return vmInfos, nil
}

// Create SSH keys for existing VMs
func setupSSHAccessForExistingVMs(vmNames []string, config *ScaleTestConfig) error {
	log.Println("🔑 Setting up SSH access for existing VMs...")

	// Initialize the private key paths map
	config.WorkerPrivateKeyPath = make(map[string]string)

	for i, vmName := range vmNames {
		// Generate SSH key pair for each VM
		privateKey, publicKey, err := generateSSHKeyPair()
		if err != nil {
			return fmt.Errorf("failed to generate SSH key for %s: %v", vmName, err)
		}

		// Save private key
		privateKeyPath, err := saveSSHKey(privateKey, fmt.Sprintf("%s_key", vmName))
		if err != nil {
			return fmt.Errorf("failed to save private key for %s: %v", vmName, err)
		}

		// Add SSH key to VM metadata
		if err := addSSHKeyToVM(vmName, publicKey, config); err != nil {
			return fmt.Errorf("failed to add SSH key to %s: %v", vmName, err)
		}

		// Store private key path
		if i == 0 { // First VM is control plane
			config.CPPrivateKeyPath = privateKeyPath
		} else { // Rest are workers
			config.WorkerPrivateKeyPath[vmName] = privateKeyPath
		}

		log.Printf("✅ SSH key configured for %s", vmName)
	}

	return nil
}

// Add SSH key to existing VM
func addSSHKeyToVM(vmName, publicKey string, config *ScaleTestConfig) error {
	sshUser := "ndmuser"
	publicKeyTrimmed := strings.TrimSpace(publicKey)
	sshKeyMetadata := fmt.Sprintf("%s:%s %s@gcp", sshUser, publicKeyTrimmed, sshUser)

	// Get the correct zone for this VM
	vmZone := getZoneForVM(vmName, config)

	cmd := fmt.Sprintf(`gcloud compute instances add-metadata %s \
        --project=%s \
        --zone=%s \
        --metadata=ssh-keys="%s"`,
		vmName, config.ProjectID, vmZone, sshKeyMetadata)

	output, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add SSH key: %v\nOutput: %s", err, string(output))
	}

	return nil
}
func sshRunScriptWithKeyOrGcloud(host, username, privateKeyPath, script, vmName string, config *ScaleTestConfig) (string, error) {
	// Use SSH with private key - no fallback
	if privateKeyPath == "" {
		return "", fmt.Errorf("private key path not available for VM %s", vmName)
	}

	return sshRunScriptWithKey(host, username, privateKeyPath, script)
}
func sshRunScriptWithGcloud(vmName, script string, config *ScaleTestConfig) (string, error) {
	// Create a temporary script file
	tmpScript := fmt.Sprintf("/tmp/script_%s_%d.sh", vmName, time.Now().Unix())
	if err := os.WriteFile(tmpScript, []byte(script), 0755); err != nil {
		return "", fmt.Errorf("failed to create temp script: %v", err)
	}
	defer os.Remove(tmpScript)

	// Get the correct zone for this VM
	vmZone := getZoneForVM(vmName, config)

	// Use gcloud to run the script
	cmd := fmt.Sprintf(`gcloud compute ssh %s \
        --project=%s \
        --zone=%s \
        --command="bash -s" \
        --ssh-flag="-o ConnectTimeout=30" < %s`,
		vmName, config.ProjectID, vmZone, tmpScript)

	output, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("gcloud SSH failed: %v\nOutput: %s", err, string(output))
	}

	return string(output), nil
}

// runNDMScaleTest runs the simplified NDM scale test
func runNDMScaleTest() error {
	projectID := "app-microservices-cm"
	SOURCE_HOST_IP := "10.192.7.42"
	DESTINATION_HOST_IP := "10.127.176.21"

	// Step 1: Get latest images
	log.Println("Fetching latest control plane image...")
	// cpImage, err := getLatestImage(projectID, "cp|control-plane")
	// if err != nil {
	// 	return fmt.Errorf("failed to get CP image: %v", err)
	// }

	log.Println("Fetching latest worker image...")
	// workerImage, err := getLatestImage(projectID, "worker")
	// if err != nil {
	// 	return fmt.Errorf("failed to get worker image: %v", err)
	// }

	cpImage := "datamigrator-control-plane-25-08-2025-19-10-33"
	workerImage := "datamigrator-worker-25-08-2025-19-05-08"

	config := &ScaleTestConfig{
		ProjectID:       projectID,
		CPImageName:     cpImage,
		WorkerImageName: workerImage,
		WorkerCount:     1,
	}

	// timestamp := time.Now().Unix()

	// Step 2: Create Control Plane VM
	// cpName := fmt.Sprintf("ndm-cp-scale-test-abhinav-%d", timestamp)
	// log.Printf("Creating Control Plane VM: %s", cpName)
	// if err := createVMWithGcloud(config, cpName, "e2-custom-8-32768", cpImage, true); err != nil {
	// 	return fmt.Errorf("failed to create control plane: %v", err)
	// }

	// // Step 3: Create Worker VM
	// workerCount := 2
	// allVMNames := []string{cpName}
	// workerNames := []string{}
	// for i := 1; i <= workerCount; i++ {
	// 	workerName := fmt.Sprintf("ndm-worker-scale-test-abhinav%d-%d", timestamp, i)
	// 	allVMNames = append(allVMNames, workerName)
	// 	workerNames = append(workerNames, workerName)
	// 	log.Printf("Creating Worker VM: %s", workerName)
	// 	if err := createVMWithGcloud(config, workerName, "e2-custom-4-16384", workerImage, false); err != nil {
	// 		return fmt.Errorf("failed to create worker: %v", err)
	// 	}
	// }
	log.Println("🏗️ Deploying infrastructure with Terraform...")
	cpIP, workerIPs, vmNames, err := deployInfrastructureWithTerraform(config)
	if err != nil {
		return fmt.Errorf("infrastructure deployment failed: %v", err)
	}

	// Get VM info from Terraform to populate dynamic names and zones
	terraformDir := "/Users/am56663/Desktop/ndm/ndm/app-deployment/terraform/gcp"
	vmInfos, err := getVMInfoFromTerraform(terraformDir)
	if err != nil {
		return fmt.Errorf("failed to get VM info from terraform: %v", err)
	}

	config.VMInfos = vmInfos
	// Find control plane VM (typically the first one)
	for _, vmInfo := range vmInfos {
		if strings.Contains(vmInfo.Name, "cp") || strings.Contains(vmInfo.Name, "control") {
			config.CPVMName = vmInfo.Name
			config.CPZone = vmInfo.Zone
			break
		}
	}
	// If no specific CP found, use the first VM
	if config.CPVMName == "" && len(vmInfos) > 0 {
		config.CPVMName = vmInfos[0].Name
		config.CPZone = vmInfos[0].Zone
	}

	if config.CPVMName == "" {
		return fmt.Errorf("no control plane VM found in Terraform state")
	}

	log.Printf("✅ Using Control Plane VM: %s in zone %s", config.CPVMName, config.CPZone)

	// Step 5: Setup SSH access for the deployed VMs
	if err := setupSSHAccessForExistingVMs(vmNames, config); err != nil {
		return fmt.Errorf("SSH setup failed: %v", err)
	}

	// Step 6: Wait for control plane to be ready
	if err := waitForControlPlaneReady(cpIP); err != nil {
		return fmt.Errorf("control plane not ready: %v", err)
	}
	// debugVMStatus(config, cpName)

	// step 9: update the global variables with current context
	CONFIG_SERVICE_URL = fmt.Sprintf("http://%s", cpIP)
	JOB_SERVICE_URL = fmt.Sprintf("http://%s", cpIP)
	ADMIN_SERVICE_URL = fmt.Sprintf("http://%s", cpIP)
	KEYCLOAK_IP = cpIP
	NDM_WORKERS_HOST = strings.Join(workerIPs, ",")
	PROTOCOL_TYPE = ProtocolNFS

	// Step 6: Handle the first login and update admin password via Keycloak API
	keycloakUser := ""
	keycloakPassword := ""
	clientSecret := ""
	log.Println("Getting Keycloak credentials from control plane...")
	creds, keycloakErr := getKeyCloakAdminCredentials(config, cpIP)
	if keycloakErr != nil {
		LogFatalf("Error getting Keycloak secrets: %v", keycloakErr)
	} else {
		keycloakUser = creds.adminUser
		keycloakPassword = creds.adminPassword
		clientSecret = creds.clientSecret
	}
	err = updateAppAdmin(keycloakUser, keycloakPassword, "admin@datamigrator.local", cpIP, "Welcome@1234")
	if err != nil {
		LogFatalf("Error updating app admin: %v", err)
	}

	// Step 7: Get bearer token for headers
	log.Println("Getting bearer token...")
	authToken, _, tokenErr := getBearerToken("", "", clientSecret, cpIP)
	if tokenErr != nil {
		LogFatalf("Error getting bearer token: %v", tokenErr)
	}
	headers := GetHeaders(authToken, ContentTypeJSON)

	// step 8: Create project and attach workets
	projectId, err := createProject(authToken, AccountId, cpIP)
	if err != nil {
		return fmt.Errorf("failed to create project: %w", err)
	}

	workerIDs := []string{}
	for idx, workerIP := range workerIPs {
		workerName := vmNames[idx+1] // Skip first VM (control plane)
		workerId, err := attachWorkers(authToken, projectId, cpIP, workerIP, workerName, config)
		if err != nil {
			log.Printf("Worker %s attachment failed (continuing): %v", workerName, err)
		} else {
			log.Printf("Worker %s attached with ID: %s to %s", workerName, workerId, cpIP)
			workerIDs = append(workerIDs, workerId)
		}
	}

	log.Printf("Sleeping for 120 seconds to allow workers to be ONLINE")
	time.Sleep(120 * time.Second)

	// step 10: create source file server and getting the desired export path ID
	sourceParams := CreateServereParams{
		ConfigName:       "source",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         "root",
		Password:         "",
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersionNFS_V3,
		Host:             SOURCE_HOST_IP,
		Workers:          workerIDs,
		WorkingDirectory: "",
	}

	log.Printf("Creating source file server with parameters: %#v", sourceParams)
	sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
	if err != nil {
		LogFatalf("Error creating source file server: %v", err)
	}
	defer resp.Body.Close()
	log.Printf("Source file server created with config ID: %#v", resp)
	log.Printf("Source file server ID: %s", sourceConfigID)
	log.Printf("Waiting for source file server to be ready")
	time.Sleep(1 * time.Minute)

	log.Printf("Getting source export path IDs")
	sourcePathIDs := []string{}
	sourceExportPaths := []string{"/volSrcAI", "/volSrcAI_clone_2", "/volSrcAI_clone_3", "/volSrcAI_clone_4", "/volSrcAI_clone_5", "/volSrcAI_clone_6", "/volSrcAI_clone_7", "/volSrcAI_clone_8"}
	for _, exportPath := range sourceExportPaths {
		sourcePathID, err := GetExportPathID("source", exportPath, sourceConfigID, headers)
		if err != nil {
			LogFatalf("Error getting source export path ID for %s: %v", exportPath, err)
		}
		sourcePathIDs = append(sourcePathIDs, sourcePathID)
	}

	// step 11: Create and run a discovery job on the source file server
	log.Printf("Creating a new discovery job for source file server")
	jobParams := DiscoveryJobParams{
		SourcePathIDs:            sourcePathIDs,
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
	sourceJobConfigIDs, resp, err := CreateDiscoveryJob(jobParams, headers)
	if err != nil {
		LogFatalf("Error creating discovery job: %v", err)
	}
	defer resp.Body.Close()
	log.Printf("Source discovery job created with config IDs: %s", sourceJobConfigIDs)

	// TODO: wait for discovery job to complete and validate the report (external JSON with desired results)

	// Create destination volumes in GCP
	log.Printf("Creating destination GCNV volume...")
	volumeCount := 8
	volumePrefix := "vol-dst-scale-automated"
	destinationExportPaths := []string{}
	volumeSize := "150"
	for i := 0; i < volumeCount; i++ {
		volumeName := fmt.Sprintf("%s-%s-%d", volumePrefix, time.Now().Format("20060102"), i+1)
		destinationExportPaths = append(destinationExportPaths, "/"+volumeName)
		volumeCreateOutput := createGCNVVolume("sp-scale-test-prem", projectID, volumeSize, volumeName, volumeName)
		if len(volumeCreateOutput) < 3 {
			LogFatalf("Error creating GCNV volume")
		}
	}
	log.Printf("Waiting 3 minutes for all volumes to be READY")
	Wait(180)

	// step 12: Create destination file server and get the destination export path
	destinationParams := CreateServereParams{
		ConfigName:       "destination",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         "root",
		Password:         "",
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersionNFS_V3,
		Host:             DESTINATION_HOST_IP,
		Workers:          workerIDs,
		WorkingDirectory: "",
	}
	log.Printf("Creating destination file server with parameters: %#v", destinationParams)
	destinationConfigID, resp, err := CreateFileServer(destinationParams, headers)
	if err != nil {
		LogFatalf("Error creating destination file server: %v", err)
	}
	defer resp.Body.Close()
	log.Printf("Destination file server created with config ID: %#v", resp)
	log.Printf("Destination file server ID: %s", destinationConfigID)
	log.Printf("Waiting for destination file server to be ready")
	time.Sleep(1 * time.Minute)

	log.Printf("Getting destination export path ID")
	destinationPathsIDs := []string{}
	for _, exportPath := range destinationExportPaths {
		destinationPathID, err := GetExportPathID("destination", exportPath, destinationConfigID, headers)
		if err != nil {
			LogFatalf("Error getting destination export path ID for %s: %v", exportPath, err)
		}
		destinationPathsIDs = append(destinationPathsIDs, destinationPathID)
	}

	// step 13: Create and run a migration job from source to destination export paths
	log.Printf("Creating a new migration job for destination file server")
	migrationParams := MigrationJobParams{
		FirstRunAt:         GetCurrentUTCTimestamp(),
		FutureRunSchedule:  "",
		SourcePathIDs:      sourcePathIDs,
		DestinationPathIDs: destinationPathsIDs,
		SidMapping:         false,
		Options: map[string]interface{}{
			"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
			"preserveAccessTime":  true,
			"skipFile":            "0-M",
		},
	}
	migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
	if err != nil {
		LogFatalf("Error creating migration job: %v", err)
	}
	log.Printf("Migration job created with config IDs: %s", migrationJobConfigIDs)
	defer resp.Body.Close()
	Wait(10)

	log.Print("Getting migration job run details")
	for _, migrationJobConfigID := range migrationJobConfigIDs {
		getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers, false)
		if err != nil {
			LogFatalf("Error getting job run details: %v", err)
		}
		log.Printf("Job Run Details: %+v", getJobsResp)
		defer resp.Body.Close()
	}
	Wait(80)

	// TODO: Wait for migration job to complete and validate the report (external JSON with desired results)
	log.Print("Waiting for migration completion")
	// for _, migrationJobConfigID := range migrationJobConfigIDs {
	// 	getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
	// 	migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
	// 	if err != nil {
	// 		LogFatalf("Error getting job run details: %v", err)
	// 	}
	// 	defer resp.Body.Close()
	// 	err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
	// 	if err != nil {
	// 		log.Printf("Migration job did not complete successfully: %v", err)
	// 	}
	// }

	log.Print("Creating bulk cutover job")
	cutoverParams := BulkCutoverJobParams{
		SourcePathIDs:      sourcePathIDs,
		DestinationPathIDs: destinationPathsIDs,
	}
	jobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
	if err != nil {
		log.Printf("Error creating bulk cutover job: %v", err)
	}
	defer resp.Body.Close()
	cutoverRunID := ""
	for _, jobConfigID := range jobConfigIDs {
		getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
		if err != nil {
			log.Printf("Error getting blocked job run ID: %v", err)
		}
		defer resp.Body.Close()
		cutoverRunID = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(cutoverRunID, BLOCKED_JOBRUN, 30)
		// Fetch the latest status
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
		if err != nil {
			log.Printf("Error getting blocked job run ID: %v", err)
		}
		defer resp.Body.Close()
	}
	log.Print("Approving bulk cutover job")
	resp, err = ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
	if err != nil {
		log.Printf("Error approving bulk cutover job: %v", err)
	}
	defer resp.Body.Close()

	log.Printf("NDM Scale Test Setup Completed!")
	log.Printf("Control Plane: %s", cpIP)
	log.Printf("Workers: %v", workerIPs)
	log.Printf("VM Names: %v", vmNames)
	log.Printf("To clean up, use terraform destroy or manually delete VMs with zones:")
	for _, vmInfo := range config.VMInfos {
		log.Printf("  gcloud compute instances delete %s --zone=%s --project=%s", vmInfo.Name, vmInfo.Zone, config.ProjectID)
	}
	log.Printf("Control Plane Dashboard: http://%s:8080", cpIP)

	return nil
}

// getZoneForVM returns the zone for a specific VM name from the VMInfos
func getZoneForVM(vmName string, config *ScaleTestConfig) string {
	for _, vmInfo := range config.VMInfos {
		if vmInfo.Name == vmName {
			return vmInfo.Zone
		}
	}
	// No fallback - return error if VM not found
	log.Fatalf("VM %s not found in Terraform VMInfos - ensure Terraform deployment succeeded", vmName)
	return ""
}

func main() {
	log.Println("Starting Simplified NDM GCP Scale Test...")
	log.Println("This will:")
	log.Println("  1. Get latest CP and Worker images")
	log.Println("  2. Create Control Plane VM with SSH keys")
	log.Println("  3. Create Worker VM with SSH keys")
	log.Println("  4. Wait for VMs to be ready and get IP addresses")
	log.Println("  5. Wait for Control Plane to respond with HTTP 200 (~30 minutes)")
	log.Println("  6. Update global service URLs with CP IP")
	log.Println("  7. Get Keycloak admin credentials and update password")
	log.Println("  8. Get bearer token for API authentication")
	log.Println("  9. Create project and attach worker to Control Plane")
	log.Println("  10. Create source file server and get export path")
	log.Println("  11. Create and run discovery job on source")
	log.Println("  12. Create destination file server and get export path")
	log.Println("  13. Create and run migration job from source to destination")

	if err := runNDMScaleTest(); err != nil {
		log.Fatalf("NDM Scale test failed: %v", err)
	}

	log.Println("NDM Scale test completed successfully!")
}
