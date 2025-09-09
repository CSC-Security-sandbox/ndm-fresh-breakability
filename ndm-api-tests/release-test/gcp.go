package releasetest

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	. "ndm-api-tests/utils"
	"os"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

var (
	logFile        *os.File
	migrationStart time.Time
	migrationEnd   time.Time
)

type ScaleTestConfig struct {
	ProjectID         string
	Zone              string
	CPImageName       string
	WorkerImageName   string
	instancePrefix    string
	WorkerCount       int
	CPSSHKeyData      string
	WorkerSSHKeysData map[string]string
	VMInfos           []VMInfo
	CPVMName          string
	CPZone            string
}
type keycloakCredentials struct {
	adminUser     string
	adminPassword string
	clientSecret  string
}
type VMInfo struct {
	Name string
	Zone string
}
type DeploymentResult struct {
	Status      string
	CPIP        string
	WorkerIPs   []string
	VMInfos     []VMInfo
	SSHKeysData map[string]string
	LogFile     string
	Error       string
}

// Initialize simple logging
func initLogging() error {
	// Create logs directory if it doesn't exist
	if err := os.MkdirAll("logs", 0755); err != nil {
		return fmt.Errorf("failed to create logs directory: %v", err)
	}

	// Create log file with timestamp
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	logFileName := fmt.Sprintf("logs/gcp_simple_%s.log", timestamp)

	var err error
	logFile, err = os.Create(logFileName)
	if err != nil {
		return fmt.Errorf("failed to create log file: %v", err)
	}

	// Create a multi-writer that writes to both file and console
	logWriter := io.MultiWriter(os.Stdout, logFile)

	// Set the default logger to write to both
	log.SetOutput(logWriter)
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	log.Printf("=== GCP SIMPLE TEST LOG STARTED ===")
	log.Printf("Log file: %s", logFileName)
	log.Printf("Start time: %s", time.Now().Format("2006-01-02 15:04:05"))
	log.Printf("============================================")

	return nil
}

// Close logging
func closeLogging() {
	if logFile != nil {
		log.Printf("============================================")
		log.Printf("=== GCP SIMPLE TEST LOG ENDED ===")
		log.Printf("End time: %s", time.Now().Format("2006-01-02 15:04:05"))

		// Log migration timing if available
		if !migrationStart.IsZero() && !migrationEnd.IsZero() {
			migrationDuration := migrationEnd.Sub(migrationStart)
			log.Printf("=== MIGRATION TIMING ===")
			log.Printf("Migration start: %s", migrationStart.Format("2006-01-02 15:04:05"))
			log.Printf("Migration end: %s", migrationEnd.Format("2006-01-02 15:04:05"))
			log.Printf("Migration duration: %v", migrationDuration)
		}

		logFile.Sync()
		logFile.Close()
	}
}

func createSSHSignerFromBase64(base64Key string) (ssh.Signer, error) {
	// Decode the base64 private key
	keyData, err := base64.StdEncoding.DecodeString(base64Key)
	if err != nil {
		return nil, fmt.Errorf("failed to decode SSH key: %v", err)
	}

	// Parse the private key
	signer, err := ssh.ParsePrivateKey(keyData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %v", err)
	}

	return signer, nil
}

// sshRunScriptWithKey runs a script on a remote host using SSH key authentication
func sshRunScriptWithKeyData(host, username, base64KeyData, script string) (string, error) {
	// Create SSH signer from base64 key data
	signer, err := createSSHSignerFromBase64(base64KeyData)
	if err != nil {
		return "", fmt.Errorf("failed to create SSH signer: %v", err)
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

func attachWorker(authToken string, projectId string, cpIp string, workerIP string, workerName string, config *ScaleTestConfig) (string, error) {
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
	if err != nil {
		return "", err
	}
	log.Printf("For worker %s registration script: %s", workerId, script)

	output, err := sshRunScriptWithKeyData(workerIP, "ndmuser", config.WorkerSSHKeysData[workerName], script)
	if err != nil {
		return workerId, err
	}
	log.Printf("Worker %s attached successfully with output: %s", workerId, output)

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

	output, err := sshRunScriptWithKeyData(cpIP, "ndmuser", config.CPSSHKeyData, script)
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

func getOpenbaoHeaders(token string) map[string]string {
	return map[string]string{
		"Content-Type":  ContentTypeForm,
		"X-Vault-Token": token,
	}
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

// cleanStoragePool removes all volumes from a storage pool to prepare for new volume creation
func cleanStoragePool(storagePoolName, projectID string) error {
	log.Printf("Cleaning storage pool: %s", storagePoolName)

	// First, list all volumes in the location and filter by storage pool
	listCmd := fmt.Sprintf(`gcloud beta netapp volumes list \
    --location=us-east4 \
    --project=%s \
    --format="get(name,storagePool)" \
    --filter="storagePool:(%s)"`,
		projectID,
		storagePoolName)

	log.Printf("Listing volumes in storage pool...")
	out, err := exec.Command("bash", "-c", listCmd).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to list volumes in storage pool %s: %v\nOutput: %s", storagePoolName, err, string(out))
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var volumeNames []string

	// Parse the output which contains both name and storagePool
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		// Split by whitespace and take the first part (volume name)
		parts := strings.Fields(line)
		if len(parts) > 0 {
			volumeNames = append(volumeNames, parts[0])
		}
	}

	if len(volumeNames) == 0 {
		log.Printf("No volumes found in storage pool %s", storagePoolName)
		return nil
	}

	log.Printf("Found %d volumes to delete: %v", len(volumeNames), volumeNames)

	// Delete each volume
	for _, volumeName := range volumeNames {
		// Extract just the volume name from the full path (e.g., projects/.../volumes/vol-name -> vol-name)
		parts := strings.Split(volumeName, "/")
		if len(parts) > 0 {
			simpleName := parts[len(parts)-1]
			log.Printf("Deleting volume: %s", simpleName)

			deleteCmd := fmt.Sprintf(`gcloud beta netapp volumes delete %s \
            --location=us-east4 \
            --project=%s \
            --quiet`,
				simpleName,
				projectID)

			deleteOut, deleteErr := exec.Command("bash", "-c", deleteCmd).CombinedOutput()
			if deleteErr != nil {
				log.Printf("Warning: Failed to delete volume %s: %v\nOutput: %s", simpleName, deleteErr, string(deleteOut))
				// Continue with other volumes instead of failing completely
			} else {
				log.Printf("Successfully deleted volume: %s", simpleName)
			}
		}
	}

	log.Printf("Storage pool cleanup completed")
	return nil
}

// parseDeploymentOutput parses the structured output from run.sh
func parseDeploymentOutput(output string) (*DeploymentResult, error) {
	result := &DeploymentResult{
		SSHKeysData: make(map[string]string),
	}

	// Find the results section - FIXED TO MATCH run.sh OUTPUT
	startMarker := "===== NDM_DEPLOYMENT_RESULTS_START ====="
	endMarker := "===== NDM_DEPLOYMENT_RESULTS_END ====="

	startIdx := strings.Index(output, startMarker)
	endIdx := strings.Index(output, endMarker)

	if startIdx == -1 || endIdx == -1 {
		// Debug: print the output to see what we're getting
		log.Printf("DEBUG: Could not find deployment markers in output")
		log.Printf("DEBUG: Looking for start marker: %s", startMarker)
		log.Printf("DEBUG: Looking for end marker: %s", endMarker)
		log.Printf("DEBUG: Output length: %d characters", len(output))
		log.Printf("DEBUG: First 1000 chars of output: %s", func() string {
			if len(output) > 1000 {
				return output[:1000] + "..."
			}
			return output
		}())
		return nil, fmt.Errorf("deployment results markers not found in output")
	}

	resultsSection := output[startIdx+len(startMarker) : endIdx]
	lines := strings.Split(strings.TrimSpace(resultsSection), "\n")

	log.Printf("DEBUG: Found results section with %d lines", len(lines))
	for i, line := range lines {
		log.Printf("DEBUG: Line %d: %s", i, strings.TrimSpace(line))
	}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			log.Printf("DEBUG: Skipping line (no colon): %s", line)
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		log.Printf("DEBUG: Parsed key=%s, value=%s", key, value)

		switch key {
		case "STATUS":
			result.Status = value
			log.Printf("DEBUG: Set Status = %s", value)
		case "CP_IP":
			result.CPIP = value
			log.Printf("DEBUG: Set CPIP = %s", value)
		case "WORKER_IPS":
			if value != "" {
				result.WorkerIPs = strings.Split(strings.Trim(value, ","), ",")
				// Remove empty strings
				var cleanIPs []string
				for _, ip := range result.WorkerIPs {
					if strings.TrimSpace(ip) != "" {
						cleanIPs = append(cleanIPs, strings.TrimSpace(ip))
					}
				}
				result.WorkerIPs = cleanIPs
				log.Printf("DEBUG: Set WorkerIPs = %v", result.WorkerIPs)
			}
		case "VM_INFO":
			if value != "" {
				vmPairs := strings.Split(strings.Trim(value, ","), ",")
				log.Printf("DEBUG: VM_INFO vmPairs = %v", vmPairs)
				for _, pair := range vmPairs {
					if strings.TrimSpace(pair) != "" {
						vmParts := strings.Split(pair, "|")
						log.Printf("DEBUG: VM pair '%s' split into %v", pair, vmParts)
						if len(vmParts) == 2 {
							vmInfo := VMInfo{
								Name: strings.TrimSpace(vmParts[0]),
								Zone: strings.TrimSpace(vmParts[1]),
							}
							result.VMInfos = append(result.VMInfos, vmInfo)
							log.Printf("DEBUG: Added VM: %+v", vmInfo)
						}
					}
				}
				log.Printf("DEBUG: Total VMInfos = %d", len(result.VMInfos))
			}
		case "SSH_KEYS_DATA":
			if value != "" {
				keyPairs := strings.Split(strings.Trim(value, ","), ",")
				log.Printf("DEBUG: SSH_KEYS_DATA keyPairs = %v", keyPairs)
				for _, pair := range keyPairs {
					if strings.TrimSpace(pair) != "" {
						keyParts := strings.Split(pair, ":")
						if len(keyParts) >= 2 {
							vmName := strings.TrimSpace(keyParts[0])
							// Join all parts after the first colon (in case key data contains colons)
							keyData := strings.TrimSpace(strings.Join(keyParts[1:], ":"))
							result.SSHKeysData[vmName] = keyData
							log.Printf("DEBUG: Added SSH key for VM: %s", vmName)
						}
					}
				}
				log.Printf("DEBUG: Total SSH keys = %d", len(result.SSHKeysData))
			}
		case "LOG_FILE":
			result.LogFile = value
		case "ERROR":
			result.Error = value
		}
	}

	log.Printf("DEBUG: Final result: Status=%s, CPIP=%s, WorkerIPs=%v, VMInfos=%d, SSHKeys=%d",
		result.Status, result.CPIP, result.WorkerIPs, len(result.VMInfos), len(result.SSHKeysData))

	return result, nil
}

func deployInfrastructureWithTerraform(config *ScaleTestConfig) (string, []string, []string, error) {
	log.Println("Deploying infrastructure using Terraform...")

	// terraformDir := "/Users/am56663/Desktop/ndm/ndm/app-deployment/terraform/gcp"
	terraformDir := "../../../app-deployment/terraform/gcp"

	// Create automated input for the run.sh script
	// Format: instancePrefix\nclusterCount\nworkerCount\ncpMachineType\ncpImage\nworkerMachineType\nworkerImage\nregion
	instancePrefix := config.instancePrefix
	if instancePrefix == "" {
		instancePrefix = "ndm-scale-auto"
	}

	input := fmt.Sprintf("%s\n1\n%d\ne2-custom-8-32768\n%s\ne2-custom-4-16384\n%s\nus-east1\n",
		instancePrefix,
		config.WorkerCount,
		config.CPImageName,
		config.WorkerImageName,
	)

	// Run the terraform script with automated input and real-time logs
	cmd := exec.Command("bash", "./run.sh")
	cmd.Dir = terraformDir
	cmd.Stdin = strings.NewReader(input)

	// Create pipes for capturing structured output while showing logs
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to create stdout pipe: %v", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to create stderr pipe: %v", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return "", nil, nil, fmt.Errorf("failed to start terraform script: %v", err)
	}

	// Buffer to capture the structured output
	var outputBuffer bytes.Buffer
	var captureResults bool

	// Channel to coordinate goroutines
	done := make(chan bool, 2)

	// Process stdout in real-time and capture structured data
	go func() {
		defer func() { done <- true }()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()

			// Check for structured data markers
			if strings.Contains(line, "===== NDM_DEPLOYMENT_RESULTS_START =====") {
				captureResults = true
				log.Printf("[TERRAFORM] %s", line)
				outputBuffer.WriteString(line + "\n")
				continue
			}

			if strings.Contains(line, "===== NDM_DEPLOYMENT_RESULTS_END =====") {
				captureResults = false
				log.Printf("[TERRAFORM] %s", line)
				outputBuffer.WriteString(line + "\n")
				continue
			}

			// Capture structured data
			if captureResults {
				log.Printf("[TERRAFORM-DATA] %s", line)
				outputBuffer.WriteString(line + "\n")
			} else {
				// Display regular logs with prefix
				log.Printf("[TERRAFORM] %s", line)
			}
		}
	}()

	// Process stderr (logs) in real-time
	go func() {
		defer func() { done <- true }()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[TERRAFORM-ERR] %s", line)
		}
	}()

	// Wait for both goroutines to finish
	<-done
	<-done

	// Wait for command to complete
	cmdErr := cmd.Wait()

	// Parse the captured structured output
	output := outputBuffer.String()
	log.Printf("DEBUG: Captured output length: %d characters", len(output))
	log.Printf("DEBUG: First 1000 chars of captured output: %s", func() string {
		if len(output) > 1000 {
			return output[:1000] + "..."
		}
		return output
	}())

	// Check if we have deployment results even if command failed
	if cmdErr != nil {
		log.Printf("Script exited with error: %v", cmdErr)
		// If we have deployment results, try to parse them anyway
		if strings.Contains(output, "===== NDM_DEPLOYMENT_RESULTS_START =====") {
			log.Printf("Found deployment results despite script error, attempting to parse...")
		} else {
			// Special handling for exit code 127 (command not found) - might be a script formatting issue
			if exitError, ok := cmdErr.(*exec.ExitError); ok && exitError.ExitCode() == 127 {
				log.Printf("Script failed with exit code 127 (command not found), checking for successful deployment...")
				// Try to get terraform outputs as fallback
				log.Printf("Falling back to terraform commands to check deployment status...")
				return getTerraformOutputs(terraformDir)
			}
			return "", nil, nil, fmt.Errorf("terraform deployment failed: %v", cmdErr)
		}
	} else {
		log.Printf("Terraform deployment completed successfully")
	}

	if output == "" {
		log.Printf("No structured output found, falling back to terraform commands...")
		return getTerraformOutputs(terraformDir)
	}

	// Parse the deployment results from run.sh output
	deployResult, err := parseDeploymentOutput(output)
	if err != nil {
		log.Printf("Failed to parse deployment output: %v", err)
		log.Printf("Falling back to terraform commands...")
		return getTerraformOutputs(terraformDir)
	}

	if deployResult.Status != "SUCCESS" {
		return "", nil, nil, fmt.Errorf("deployment failed: %s", deployResult.Error)
	}

	// Store SSH key information in config for later use
	config.WorkerSSHKeysData = make(map[string]string)
	var vmNames []string

	for _, vmInfo := range deployResult.VMInfos {
		vmNames = append(vmNames, vmInfo.Name)

		// Find SSH key path for this VM
		if keyPath, exists := deployResult.SSHKeysData[vmInfo.Name]; exists {
			if strings.Contains(vmInfo.Name, "cp") || strings.Contains(vmInfo.Name, "control") {
				config.CPSSHKeyData = keyPath
				config.CPVMName = vmInfo.Name
				config.CPZone = vmInfo.Zone
			} else {
				config.WorkerSSHKeysData[vmInfo.Name] = keyPath
			}
		}
	}

	if len(deployResult.WorkerIPs) == 1 && strings.Contains(deployResult.WorkerIPs[0], " ") {
		// Split the single string by spaces and replace the array
		deployResult.WorkerIPs = strings.Fields(deployResult.WorkerIPs[0])
		log.Printf("Split workerIPs from single string: %v", deployResult.WorkerIPs)
	}

	// Store VM info in config
	config.VMInfos = deployResult.VMInfos

	log.Printf("Deployment completed with SSH keys configured and CP ready!")
	log.Printf("Terraform log available at: %s", deployResult.LogFile)
	log.Printf("SSH keys stored as variables")
	log.Printf("Control Plane: %s (ready and verified)", deployResult.CPIP)
	log.Printf("Workers: %v", deployResult.WorkerIPs)
	log.Printf(" VMs: %v", vmNames)

	return deployResult.CPIP, deployResult.WorkerIPs, vmNames, nil
}

// Get terraform outputs and VM names
func getTerraformOutputs(terraformDir string) (string, []string, []string, error) {
	log.Println("Getting IP addresses and VM names from Terraform...")

	// Get control plane IP
	cmd := exec.Command("terraform", "output", "-json", "control_plane_internal_ips")
	cmd.Dir = terraformDir
	cpOutput, err := cmd.CombinedOutput()
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to get control plane IPs: %v", err)
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
		return "", nil, nil, fmt.Errorf("failed to get worker IPs: %v", err)
	}

	var workerIPs []string
	if err := json.Unmarshal(workerOutput, &workerIPs); err != nil {
		return "", nil, nil, fmt.Errorf("failed to parse worker IPs: %v", err)
	}

	if len(workerIPs) == 1 && strings.Contains(workerIPs[0], " ") {
		// Split the single string by spaces and replace the array
		workerIPs = strings.Fields(workerIPs[0])
		log.Printf("Split workerIPs from single string: %v", workerIPs)
	}

	// Get VM names from terraform state
	// Get VM info
	vmInfos, err := getVMInfoFromTerraform(terraformDir)
	if err != nil {
		return "", nil, nil, fmt.Errorf("failed to get VM info: %v", err)
	}

	var vmNames []string
	for _, vmInfo := range vmInfos {
		vmNames = append(vmNames, vmInfo.Name)
	}

	log.Printf("Control Plane IP: %s", cpIPs[0])
	log.Printf("Worker IPs: %v", workerIPs)
	log.Printf("VM Names: %v", vmNames)

	return cpIPs[0], workerIPs, vmNames, nil
}

// pollJobRunsInfinite polls a list of job config IDs until all reach completion or failure.
// This unified function replaces separate polling logic for migration and cutover jobs.
//
// Features:
// - Robust error handling with per-job error tracking
// - Infinite polling with configurable intervals
// - Support for both COMPLETED and BLOCKED (cutover) job states
// - Comprehensive logging with job type prefixes
// - Automatic log flushing for real-time monitoring
//
// Parameters:
// - jobConfigIDs: List of job configuration IDs to poll
// - jobType: Type of job for logging context (e.g., "MIGRATION", "CUTOVER")
// - headers: HTTP headers for API authentication
// - pollInterval: Time to wait between polling cycles
//
// Returns error if any job fails or if too many consecutive API errors occur.
func pollJobRunsInfinite(jobConfigIDs []string, jobType string, headers map[string]string, pollInterval time.Duration) error {
	if len(jobConfigIDs) == 0 {
		return fmt.Errorf("no job config IDs provided for polling")
	}

	log.Printf("Starting infinite polling for %d %s job runs", len(jobConfigIDs), jobType)

	// Track completion status and start times for each job
	jobCompleted := make(map[string]bool)
	jobStartTime := make(map[string]time.Time)
	jobErrorCount := make(map[string]int) // Track consecutive errors per job

	for _, jobConfigID := range jobConfigIDs {
		jobCompleted[jobConfigID] = false
		jobStartTime[jobConfigID] = time.Now()
		jobErrorCount[jobConfigID] = 0
	}

	pollCount := 0
	maxConsecutiveErrors := 10 // Allow up to 10 consecutive errors per job before giving up

	for {
		pollCount++
		log.Printf("[%s] Poll cycle #%d started", jobType, pollCount)

		allJobsCompleted := true
		completedCount := 0

		for _, jobConfigID := range jobConfigIDs {
			if jobCompleted[jobConfigID] {
				completedCount++
				continue
			}

			// Get current job status
			jobDetails, resp, err := GetJobRunDetails(jobConfigID, headers, false)
			if err != nil {
				jobErrorCount[jobConfigID]++
				log.Printf("ERROR fetching status for %s job %s (error #%d): %v",
					jobType, jobConfigID, jobErrorCount[jobConfigID], err)

				if resp != nil {
					resp.Body.Close()
				}

				// If too many consecutive errors for this job, mark it as failed
				if jobErrorCount[jobConfigID] >= maxConsecutiveErrors {
					log.Printf("FATAL: %s job %s failed after %d consecutive API errors",
						jobType, jobConfigID, maxConsecutiveErrors)
					return fmt.Errorf("%s job %s failed after %d consecutive API errors",
						jobType, jobConfigID, maxConsecutiveErrors)
				}

				allJobsCompleted = false
				continue
			}

			// Reset error count on successful API call
			jobErrorCount[jobConfigID] = 0

			if resp != nil {
				resp.Body.Close()
			}

			if len(jobDetails.JobRuns) > 0 {
				currentState := jobDetails.JobRuns[0].Status
				jobRuntime := time.Since(jobStartTime[jobConfigID])

				// Check if job completed successfully
				if currentState == COMPLETED_JOBRUN || currentState == "COMPLETED" {
					log.Printf("[%s] Job %s COMPLETED (runtime: %v)", jobType, jobConfigID, jobRuntime.Round(time.Minute))
					jobCompleted[jobConfigID] = true
					completedCount++
					continue
				}

				// Check for blocked state (specifically for cutover jobs)
				if currentState == BLOCKED_JOBRUN {
					log.Printf("[%s] Job %s BLOCKED - waiting for approval (runtime: %v)", jobType, jobConfigID, jobRuntime.Round(time.Minute))
					jobCompleted[jobConfigID] = true
					completedCount++
					continue
				}

				// Check for failure states
				if currentState == "FAILED" || currentState == "CANCELLED" || currentState == "ERROR" || currentState == ERRORED_JOBRUN {
					log.Printf("[%s] Job %s FAILED with state: %s (runtime: %v)", jobType, jobConfigID, currentState, jobRuntime.Round(time.Minute))
					return fmt.Errorf("%s job %s failed with state: %s after running for %v", jobType, jobConfigID, currentState, jobRuntime.Round(time.Minute))
				}

				// Job is still running
				log.Printf("[%s] Job %s status: %s (runtime: %v)", jobType, jobConfigID, currentState, jobRuntime.Round(time.Minute))
				allJobsCompleted = false
			} else {
				log.Printf("WARNING: No job runs found for %s job %s", jobType, jobConfigID)
				allJobsCompleted = false
			}
		}

		// Check if all jobs are completed
		if allJobsCompleted {
			log.Printf("[%s] ALL JOBS COMPLETED after %d poll cycles", jobType, pollCount)
			break
		}

		// Status summary
		remainingJobs := len(jobConfigIDs) - completedCount
		log.Printf("[%s] Status: %d/%d completed, %d running. Sleeping for %v",
			jobType, completedCount, len(jobConfigIDs), remainingJobs, pollInterval)

		// Force flush logs to file
		if logFile != nil {
			logFile.Sync()
		}

		time.Sleep(pollInterval)
	}

	return nil
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

// runNDMScaleTest runs the simplified NDM scale test with unified job polling.
//
// This function orchestrates a complete end-to-end NDM scale test on GCP, including:
// - Infrastructure deployment with Terraform
// - Control plane setup and worker registration
// - Source and destination file server configuration
// - Migration job creation and execution with robust polling
// - Cutover job creation, polling, and approval
//
// POLLING IMPROVEMENTS:
// - Uses unified pollJobRunsInfinite() for both migration and cutover jobs
// - Robust error handling with per-job error tracking (max 10 consecutive errors)
// - Comprehensive logging with job type prefixes for better monitoring
// - Automatic log flushing for real-time visibility
// - Support for both COMPLETED and BLOCKED job states
//
// Parameters:
// - cpImageName: Control plane Docker image name
// - workerImageName: Worker Docker image name
// - instancePrefix: Optional prefix for VM instance names
//
// Returns error if any step fails, including job polling failures.
func runNDMScaleTest(cpImageName, workerImageName, instancePrefix string) error {
	projectID := "app-microservices-cm"
	SOURCE_HOST_IP := "172.30.121.91"
	DESTINATION_HOST_IP := "10.127.176.21"

	// Validate required image names
	if cpImageName == "" {
		return fmt.Errorf("cpImageName is required")
	}
	if workerImageName == "" {
		return fmt.Errorf("workerImageName is required")
	}

	log.Printf("=== STEP 1: INITIALIZATION ===")
	log.Printf("Using Control Plane image: %s", cpImageName)
	log.Printf("Using Worker image: %s", workerImageName)
	if instancePrefix != "" {
		log.Printf("Using instance prefix: %s", instancePrefix)
	} else {
		log.Printf("Using default instance prefix")
	}

	workerCount := 2
	config := &ScaleTestConfig{
		ProjectID:       projectID,
		CPImageName:     cpImageName,
		WorkerImageName: workerImageName,
		instancePrefix:  instancePrefix,
		WorkerCount:     workerCount,
	}

	// Step 2: Deploy infrastructure, setup SSH, and wait for CP (all handled by run.sh)
	log.Printf("=== STEP 2: INFRASTRUCTURE DEPLOYMENT ===")
	log.Println("Deploying infrastructure with Terraform (includes SSH setup and CP health check)...")
	cpIP, workerIPs, vmNames, err := deployInfrastructureWithTerraform(config)
	if err != nil {
		return fmt.Errorf("infrastructure deployment failed: %v", err)
	}

	// Validate that we have the required VM info from the deployment
	if config.CPVMName == "" {
		return fmt.Errorf("no control plane VM found in deployment results")
	}
	log.Printf("Using Control Plane VM: %s in zone %s", config.CPVMName, config.CPZone)

	// Step 3: SSH setup and CP readiness already handled by run.sh
	log.Printf("=== STEP 3: SSH VERIFICATION ===")
	log.Println("SSH keys configured and Control Plane verified as ready by deployment script")

	// Step 4: Update global variables with current context
	log.Printf("=== STEP 4: GLOBAL CONFIGURATION ===")
	CONFIG_SERVICE_URL = fmt.Sprintf("http://%s", cpIP)
	JOB_SERVICE_URL = fmt.Sprintf("http://%s", cpIP)
	ADMIN_SERVICE_URL = fmt.Sprintf("http://%s", cpIP)
	KEYCLOAK_IP = cpIP
	NDM_WORKERS_HOST = strings.Join(workerIPs, ",")
	PROTOCOL_TYPE = ProtocolNFS
	USERNAME = "admin@datamigrator.local"

	// Step 5: Handle the first login and update admin password via Keycloak API
	log.Printf("=== STEP 5: KEYCLOAK AUTHENTICATION ===")
	keycloakUser := ""
	keycloakPassword := ""
	log.Println("Getting Keycloak credentials from control plane...")
	creds, keycloakErr := getKeyCloakAdminCredentials(config, cpIP)
	if keycloakErr != nil {
		LogFatalf("Error getting Keycloak secrets: %v", keycloakErr)
	} else {
		keycloakUser = creds.adminUser
		keycloakPassword = creds.adminPassword
		CLIENT_SECRET = creds.clientSecret
	}
	err = UpdateAppAdmin(keycloakUser, keycloakPassword)
	if err != nil {
		LogFatalf("Error updating app admin: %v", err)
	}

	// Step 6: Get bearer token for headers
	log.Printf("=== STEP 6: BEARER TOKEN ===")
	log.Println("Getting bearer token...")
	authToken, _, tokenErr := GetBearerToken("", "")
	if tokenErr != nil {
		LogFatalf("Error getting bearer token: %v", tokenErr)
	}
	headers := GetHeaders(authToken, ContentTypeJSON)

	// step 7: Create project and attach workers
	log.Printf("=== STEP 7: PROJECT AND WORKERS ===")
	projectId, err := CreateProject(authToken, AccountId)
	if err != nil {
		return fmt.Errorf("failed to create project: %w", err)
	}

	workerIDs := []string{}
	log.Print(workerIPs)

	log.Print(config.WorkerSSHKeysData)
	for idx, workerIP := range workerIPs {
		workerName := vmNames[idx+1] // Skip first VM (control plane)
		log.Printf("Attaching worker %d: IP=%s, Name=%s", idx+1, workerIP, workerName)
		log.Print(workerIP)
		workerId, err := attachWorker(authToken, projectId, cpIP, workerIP, workerName, config)
		if err != nil {
			log.Printf("Worker %s attachment failed (continuing): %v", workerName, err)
		} else {
			log.Printf("Worker %s attached with ID: %s to %s", workerName, workerId, cpIP)
			workerIDs = append(workerIDs, workerId)
		}
	}

	log.Printf("Sleeping for 120 seconds to allow workers to be ONLINE")
	Wait(120)

	// e2e

	// step 8: create source file server and getting the desired export path ID
	log.Printf("=== STEP 8: SOURCE FILE SERVER ===")
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
	log.Printf("Source file server created with config ID: %s", sourceConfigID)
	log.Printf("Waiting for source file server to be ready")
	Wait(60)

	log.Printf("Getting source export path IDs")
	sourcePathIDs := []string{}
	sourceExportPaths := []string{"/volSrcAI", "/volSrcAI_clone_2", "/volSrcAI_clone_3", "/volSrcAI_clone_4"}
	for _, exportPath := range sourceExportPaths {
		sourcePathID, err := GetExportPathID("source", exportPath, sourceConfigID, headers)
		if err != nil {
			LogFatalf("Error getting source export path ID for %s: %v", exportPath, err)
		}
		sourcePathIDs = append(sourcePathIDs, sourcePathID)
	}

	// step 9: Create and run a discovery job on the source file server
	log.Printf("=== STEP 9: DISCOVERY JOB ===")
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

	// step 10: Clean storage pool and create destination volumes in GCP
	log.Printf("=== STEP 10: DESTINATION VOLUMES ===")
	storagePoolName := "sp-scale-test-prem"

	// Clean the storage pool before creating new volumes
	log.Printf("Cleaning storage pool: %s", storagePoolName)
	err = cleanStoragePool(storagePoolName, projectID)
	if err != nil {
		log.Printf("Warning: Failed to clean storage pool %s: %v", storagePoolName, err)
		log.Printf("Continuing with volume creation...")
	} else {
		log.Printf("Storage pool %s cleaned successfully", storagePoolName)
	}

	log.Printf("Creating destination GCNV volumes...")
	volumeCount := 4
	volumePrefix := "vol-dst-scale-automated"
	destinationExportPaths := []string{}
	volumeSize := "1024"
	for i := 0; i < volumeCount; i++ {
		volumeName := fmt.Sprintf("%s-%s-%d", volumePrefix, time.Now().Format("20060102"), i+1)
		destinationExportPaths = append(destinationExportPaths, "/"+volumeName)
		volumeCreateOutput := createGCNVVolume(storagePoolName, projectID, volumeSize, volumeName, volumeName)
		if len(volumeCreateOutput) < 3 {
			LogFatalf("Error creating GCNV volume")
		}
	}
	log.Printf("Waiting 3 minutes for all volumes to be READY")
	Wait(180)

	// step 11: Create destination file server and get the destination export path
	log.Printf("=== STEP 11: DESTINATION FILE SERVER ===")
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
	log.Printf("Destination file server created with config ID: %s", destinationConfigID)
	log.Printf("Waiting for destination file server to be ready")
	Wait(60)

	log.Printf("Getting destination export path ID")
	destinationPathsIDs := []string{}
	for _, exportPath := range destinationExportPaths {
		destinationPathID, err := GetExportPathID("destination", exportPath, destinationConfigID, headers)
		if err != nil {
			LogFatalf("Error getting destination export path ID for %s: %v", exportPath, err)
		}
		destinationPathsIDs = append(destinationPathsIDs, destinationPathID)
	}

	// step 12: Create and run a migration job from source to destination export paths
	log.Printf("=== STEP 12: MIGRATION JOB ===")
	migrationStart = time.Now() // Record migration start time
	log.Printf("MIGRATION START TIME: %s", migrationStart.Format("2006-01-02 15:04:05"))

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

	// Wait for migration to complete using unified polling function
	pollInterval := 5 * time.Minute
	err = pollJobRunsInfinite(migrationJobConfigIDs, "MIGRATION", headers, pollInterval)
	if err != nil {
		LogFatalf("Migration polling failed: %v", err)
	}

	migrationEnd = time.Now() // Record migration end time
	log.Printf("MIGRATION END TIME: %s", migrationEnd.Format("2006-01-02 15:04:05"))
	log.Printf("MIGRATION DURATION: %v", migrationEnd.Sub(migrationStart))

	// step 13: Create and run cutover job
	log.Printf("=== STEP 13: CUTOVER JOB ===")
	log.Print("Creating bulk cutover job")
	cutoverParams := BulkCutoverJobParams{
		SourcePathIDs:      sourcePathIDs,
		DestinationPathIDs: destinationPathsIDs,
	}
	jobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
	if err != nil {
		LogFatalf("Error creating bulk cutover job: %v", err)
	}
	defer resp.Body.Close()

	// Wait for cutover jobs to reach BLOCKED state using unified polling
	log.Print("Waiting for cutover jobs to reach BLOCKED state")
	cutoverPollInterval := 30 * time.Second
	err = pollJobRunsInfinite(jobConfigIDs, "CUTOVER", headers, cutoverPollInterval)
	if err != nil {
		LogFatalf("Cutover polling failed: %v", err)
	}

	// Approve all cutover jobs (get run IDs for each job config ID)
	log.Printf("Approving all %d cutover jobs", len(jobConfigIDs))
	for i, jobConfigID := range jobConfigIDs {
		log.Printf("Getting job run details for cutover job config %d/%d: %s", i+1, len(jobConfigIDs), jobConfigID)
		getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
		if err != nil {
			LogFatalf("Error getting cutover job run details for approval (config %s): %v", jobConfigID, err)
		}

		if len(getJobsResp.JobRuns) == 0 {
			resp.Body.Close()
			LogFatalf("No job runs found for cutover job config %s", jobConfigID)
		}

		cutoverRunID := getJobsResp.JobRuns[0].JobRunId
		resp.Body.Close()

		log.Printf("Approving cutover job %d/%d with config ID %s, run ID: %s", i+1, len(jobConfigIDs), jobConfigID, cutoverRunID)
		approvalResp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
		if err != nil {
			LogFatalf("Error approving cutover job %s (run ID %s): %v", jobConfigID, cutoverRunID, err)
		}
		approvalResp.Body.Close()
		log.Printf("Successfully approved cutover job %d/%d", i+1, len(jobConfigIDs))
	}

	log.Printf("=== TEST COMPLETED SUCCESSFULLY ===")
	log.Printf("Control Plane: %s", cpIP)
	log.Printf("Workers: %v", workerIPs)
	log.Printf("VM Names: %v", vmNames)
	log.Println("To clean up, use terraform destroy or manually delete VMs with zones:")
	for _, vmInfo := range config.VMInfos {
		log.Printf("  gcloud compute instances delete %s --zone=%s --project=%s", vmInfo.Name, vmInfo.Zone, config.ProjectID)
	}
	log.Printf("Control Plane Dashboard: http://%s:8080", cpIP)

	return nil
}

func main() {
	// Initialize logging first
	if err := initLogging(); err != nil {
		fmt.Printf("Failed to initialize logging: %v\n", err)
		os.Exit(1)
	}
	defer closeLogging()

	log.Println("=== NDM SCALE TEST STARTED ===")
	log.Println("This enhanced workflow includes:")
	log.Println("  1. Use specified CP and Worker images")
	log.Println("  2. Deploy infrastructure with Terraform (includes SSH setup and CP health check)")
	log.Println("  3. Update global service URLs with CP IP")
	log.Println("  4. Get Keycloak admin credentials and update password")
	log.Println("  5. Get bearer token for API authentication")
	log.Println("  6. Create project and attach workers to Control Plane")
	log.Println("  7. Create source file server and get export paths")
	log.Println("  8. Create and run discovery job on source")
	log.Println("  9. Create destination GCNV volumes in GCP")
	log.Println("  10. Create destination file server and get export paths")
	log.Println("  11. Create and run migration job from source to destination")
	log.Println("  12. Create and run cutover job")
	log.Println("")

	// Parse command-line arguments
	var cpImageName, workerImageName, instancePrefix string

	if len(os.Args) < 3 {
		log.Fatalf("Usage: %s <cpImageName> <workerImageName> [instancePrefix]", os.Args[0])
	}

	cpImageName = os.Args[1]
	workerImageName = os.Args[2]

	if len(os.Args) > 3 {
		instancePrefix = os.Args[3]
	}

	log.Printf("Arguments: cpImageName=%s, workerImageName=%s, instancePrefix=%s", cpImageName, workerImageName, instancePrefix)

	if err := runNDMScaleTest(cpImageName, workerImageName, instancePrefix); err != nil {
		log.Fatalf("NDM Scale test failed: %v", err)
	}

	log.Println("NDM Scale test completed successfully!")
}
