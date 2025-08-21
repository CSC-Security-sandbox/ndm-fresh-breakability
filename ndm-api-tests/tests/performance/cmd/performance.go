package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
	
	"github.com/joho/godotenv"
	. "ndm-api-tests/tests/performance"
)

func main(){
	fmt.Println("🚀 Starting NDM Complete Performance Test Pipeline...")
	
	fmt.Println("\n📋 Step 1: Creating Azure VMs...")
	cpIP, workerIP, err := createAzureVMs()
	if err != nil {
		log.Fatalf("❌ Failed to create Azure VMs: %v", err)
	}
	
	fmt.Println("\n📋 Step 2: Updating environment variables with VM IPs...")
	// Update environment with the IPs from VM creation
	err = updateEnvFile(cpIP, workerIP)
	if err != nil {
		log.Printf("❌ Failed to update environment variables: %v", err)
		fmt.Println("⚠️  Proceeding with manual environment setup...")
		fmt.Printf("   Please manually set: CP=%s, Worker=%s\n", cpIP, workerIP)
	} else {
		fmt.Println("✅ Environment variables updated successfully!")
	}
	
	// Load .env file from parent directory
	err = godotenv.Load("../.env")
	if err != nil {
		log.Printf("Warning: Error loading .env file: %v", err)
	} else {
		fmt.Println("✅ .env file loaded successfully!")
		
		// Print key environment variables for verification
		fmt.Println("\n🔍 Environment Variables after loading .env:")
		fmt.Printf("   AZ_KEYCLOAK_IP: %s\n", os.Getenv("AZ_KEYCLOAK_IP"))
		fmt.Printf("   AZ_NDM_VM_HOST: %s\n", os.Getenv("AZ_NDM_VM_HOST"))
		fmt.Printf("   AZ_NDM_WORKERS_HOST: %s\n", os.Getenv("AZ_NDM_WORKERS_HOST"))
		fmt.Printf("   AZ_JOB_SERVICE_URL: %s\n", os.Getenv("AZ_JOB_SERVICE_URL"))
		fmt.Printf("   AZ_CONFIG_SERVICE_URL: %s\n", os.Getenv("AZ_CONFIG_SERVICE_URL"))
		fmt.Printf("   AZ_ADMIN_SERVICE_URL: %s\n", os.Getenv("AZ_ADMIN_SERVICE_URL"))
		fmt.Printf("   AZ_NDM_VM_USER_NAME: %s\n", os.Getenv("AZ_NDM_VM_USER_NAME"))
		fmt.Printf("   AZ_SOURCE_HOST_IP: %s\n", os.Getenv("AZ_SOURCE_HOST_IP"))
		fmt.Printf("   AZ_DESTINATION_HOST_IP: %s\n", os.Getenv("AZ_DESTINATION_HOST_IP"))
	}
	
	fmt.Println("\n🔍 Step 3: Waiting for Control Plane to be ready...")
	err = waitForControlPlaneReadyWithIP(cpIP)
	if err != nil {
		log.Printf("❌ Control Plane readiness check failed: %v", err)
		fmt.Println("⚠️  Proceeding anyway...")
	}
	
	fmt.Println("\n🎯 Step 4: Initializing performance test environment...")
	//init test env with full authentication
	InitTestEnv()
	fmt.Println("🎯 Performance test environment initialized successfully.")
	fmt.Printf("🔐 Password: %s\n", PASSWORD)
	
	if AuthToken != "" && len(AuthToken) > 20 {
		fmt.Printf("🎫 Auth Token: %s...\n", AuthToken[:20])
	}
	if KeycloakUser != "" {
		fmt.Printf("👤 Keycloak User: %s\n", KeycloakUser)
	}
	
	// Setup test environment with workers
	fmt.Println("\n🔧 Setting up test environment with workers...")
	workerCount := 1 // Start with 1 worker (reduced from 2)
	projectId, workersConfig, err := SetupTestEnv(workerCount)
	if err != nil {
		fmt.Printf("❌ Failed to setup test environment: %v\n", err)
		return
	}
	
	fmt.Printf("✅ Test environment setup completed!\n")
	fmt.Printf("📋 Project ID: %s\n", projectId)
	fmt.Printf("👷 Workers attached: %d\n", len(workersConfig))
	
	// Display worker information
	for workerName, config := range workersConfig {
		fmt.Printf("   Worker: %s (Host: %s:%d)\n", workerName, config.Host, config.Port)
	}
	
	// Setup source file server
	fmt.Println("\n📁 Setting up source file server...")
	
	// Prepare headers for API requests
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  "application/json",
	}
	
	// Get worker IDs for the project
	workerIds := GetWorkerIds()
	if len(workerIds) == 0 {
		fmt.Printf("❌ No worker IDs available for project %s\n", projectId)
		return
	}
	
	// Create source file server parameters using environment variables
	sourceParams := CreateServereParams{
		ConfigName:       "Source-FileServer-Performance-Test",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         NDM_VM_USER_NAME,    // From AZ_NDM_VM_USER_NAME
		Password:         NDM_VM_PASSWORD,     // From AZ_NDM_VM_PASSWORD  
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             SOURCE_HOST_IP,      // From AZ_SOURCE_HOST_IP (10.0.0.169)
		Workers:          workerIds,
		WorkingDirectory: "/tmp",
		ExportPathSource: nil, // Will use AutoDiscover default from file_server.go
	}
	
	fmt.Printf("   Creating source file server at %s with user %s...\n", SOURCE_HOST_IP, NDM_VM_USER_NAME)
	fmt.Printf("   Using workers: %v\n", workerIds)
	
	// Call the CreateFileServer function from file_server.go
	sourceFileServerId, resp, err := CreateFileServer(sourceParams, headers)
	if err != nil {
		fmt.Printf("❌ Failed to create source file server: %v\n", err)
		return
	}
	
	// Check response status
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		fmt.Printf("❌ Source file server creation failed with status: %d\n", resp.StatusCode)
		return
	}
	
	fmt.Printf("✅ Source file server created with ID: %s\n", sourceFileServerId)
	
	// Setup destination file server
	fmt.Println("\n📁 Setting up destination file server...")
	
	// Create destination file server parameters
	destinationParams := CreateServereParams{
		ConfigName:       "Destination-FileServer-Performance-Test",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         NDM_VM_USER_NAME,    // From AZ_NDM_VM_USER_NAME
		Password:         NDM_VM_PASSWORD,     // From AZ_NDM_VM_PASSWORD  
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             DESTINATION_HOST_IP, // From AZ_DESTINATION_HOST_IP (10.0.4.9)
		Workers:          workerIds,
		WorkingDirectory: "/tmp",
		ExportPathSource: nil, // Will use AutoDiscover default
	}
	
	if DESTINATION_HOST_IP == "" {
		fmt.Printf("⚠️  Warning: AZ_DESTINATION_HOST_IP not set, skipping destination file server setup\n")
		fmt.Printf("   To add destination server, set AZ_DESTINATION_HOST_IP=10.0.4.9 in your .env file\n")
	} else {
		fmt.Printf("   Creating destination file server at %s with user %s...\n", DESTINATION_HOST_IP, NDM_VM_USER_NAME)
		fmt.Printf("   Using workers: %v\n", workerIds)
		
		// Retry logic for destination file server creation
		var destinationFileServerId string
		var destResp *http.Response
		maxRetries := 5
		retrySuccess := false
		
		for attempt := 1; attempt <= maxRetries; attempt++ {
			fmt.Printf("   🔄 Attempt %d/%d: Creating destination file server...\n", attempt, maxRetries)
			
			// Call the CreateFileServer function for destination
			destinationFileServerId, destResp, err = CreateFileServer(destinationParams, headers)
			if err != nil {
				fmt.Printf("   ❌ Attempt %d failed with error: %v\n", attempt, err)
				if attempt < maxRetries {
					fmt.Printf("   ⏳ Waiting 10 seconds before retry...\n")
					time.Sleep(10 * time.Second)
					continue
				}
			} else if destResp.StatusCode != 200 && destResp.StatusCode != 201 {
				fmt.Printf("   ❌ Attempt %d failed with status: %d\n", attempt, destResp.StatusCode)
				if attempt < maxRetries {
					fmt.Printf("   ⏳ Waiting 10 seconds before retry...\n")
					time.Sleep(10 * time.Second)
					continue
				}
			} else {
				fmt.Printf("   ✅ Destination file server created successfully on attempt %d with ID: %s\n", attempt, destinationFileServerId)
				retrySuccess = true
				break
			}
		}
		
		if retrySuccess {
			// Create migration job from /mnt/data/AI (source) to /kb-vol-perf-run (destination)
			fmt.Println("\n🚚 Setting up migration job...")
			err = setupMigrationJob(sourceFileServerId, destinationFileServerId, headers)
			if err != nil {
				fmt.Printf("⚠️  Warning: Failed to setup migration job: %v\n", err)
			}
		} else {
			fmt.Printf("❌ Failed to create destination file server after %d attempts. Possible issues:\n", maxRetries)
			fmt.Printf("   • Host %s may not be accessible from workers\n", DESTINATION_HOST_IP)
			fmt.Printf("   • NFS service may not be running on destination host\n")
			fmt.Printf("   • Network connectivity issues between worker and destination\n")
			fmt.Printf("   • Invalid credentials for destination host\n")
			fmt.Printf("   💡 Check destination host accessibility and NFS configuration\n")
		}
	}
	
	fmt.Println("\n🎯 NDM Performance Test Environment is ready for testing!")
	fmt.Println("📊 Ready for data migration performance tests!")
	fmt.Printf("🔗 Source Host: %s\n", SOURCE_HOST_IP)
	fmt.Printf("📁 Source File Server ID: %s\n", sourceFileServerId)
	if DESTINATION_HOST_IP != "" {
		fmt.Printf("🎯 Destination Host: %s\n", DESTINATION_HOST_IP)
		fmt.Printf("📁 Destination Volume: %s:/kb-vol-perf-run\n", DESTINATION_HOST_IP)
	}
	fmt.Printf("++++++++++++PASSSWORD+++++++++++%s", PASSWORD)
}

// setupMigrationJob creates a migration job from source to destination
func setupMigrationJob(sourceFileServerId, destinationFileServerId string, headers map[string]string) error {
	// Get source path ID for /mnt/data/AI
	fmt.Println("   Getting source path ID for /mnt/data/AI...")
	sourcePathId, err := GetExportPathID("source", "/mnt/data/AI", sourceFileServerId, headers)
	if err != nil {
		return fmt.Errorf("failed to get source path ID: %w", err)
	}
	fmt.Printf("   Source path ID: %s\n", sourcePathId)
	
	// Get destination path ID for /kb-vol-perf-run
	fmt.Println("   Getting destination path ID for /kb-vol-perf-run...")
	destinationPathId, err := GetExportPathID("destination", "/kb-vol-perf-run", destinationFileServerId, headers)
	if err != nil {
		return fmt.Errorf("failed to get destination path ID: %w", err)
	}
	fmt.Printf("   Destination path ID: %s\n", destinationPathId)
	
	// Create migration job parameters
	migrationParams := MigrationJobParams{
		FirstRunAt:         GetCurrentUTCTimestamp(), // Use proper timestamp
		FutureRunSchedule:  "",     // No recurring schedule
		SourcePathIDs:      []string{sourcePathId},
		DestinationPathIDs: []string{destinationPathId},
		SidMapping:         false,  // No SID mapping needed
		Options: map[string]interface{}{
			"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
			"preserveAccessTime":  true,
			"skipFile":            "0-M", // Use 0-M to migrate all files regardless of size
		},
	}
	
	// Create the migration job
	fmt.Println("   Creating migration job...")
	jobIds, resp, err := CreateMigrationJob(migrationParams, headers)
	if err != nil {
		return fmt.Errorf("failed to create migration job: %w", err)
	}
	
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("migration job creation failed with status: %d", resp.StatusCode)
	}
	
	if len(jobIds) > 0 {
		fmt.Printf("✅ Migration job created successfully with ID: %s\n", jobIds[0])
		fmt.Printf("   Migration: %s:/mnt/data/AI → %s:/kb-vol-perf-run\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)
		
		// Get job run details to verify the job was created properly
		fmt.Println("   Getting job run details...")
		getJobsResp, resp, err := GetJobRunDetails(jobIds[0], headers)
		if err != nil {
			return fmt.Errorf("failed to get job run details: %w", err)
		}
		
		if resp.StatusCode != 200 {
			return fmt.Errorf("failed to get job run details, status: %d", resp.StatusCode)
		}
		
		if len(getJobsResp.JobRuns) > 0 {
			jobRunID := getJobsResp.JobRuns[0].JobRunId
			fmt.Printf("   Job Run ID: %s\n", jobRunID)
			fmt.Printf("   Job Status: %s\n", getJobsResp.JobRuns[0].Status)
			
			// Optional: Wait for job to start running
			fmt.Println("   ⏳ Waiting for migration job to start...")
			err = WaitForJobState(jobRunID, RUNNING_JOBRUN)
			if err != nil {
				fmt.Printf("   ⚠️  Warning: Job may not have started yet: %v\n", err)
			} else {
				fmt.Printf("   🚀 Migration job is now RUNNING!\n")
			}
		}
	} else {
		return fmt.Errorf("no job IDs returned from migration job creation")
	}
	
	return nil
}

// createAzureVMs creates both control plane and worker VMs using Azure CLI
// Returns the IPs of the created VMs
func createAzureVMs() (string, string, error) {
	fmt.Println("   🔧 Checking Azure CLI authentication...")
	
	// Check if Azure CLI is available and logged in
	cmd := exec.Command("az", "account", "show")
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("Azure CLI not logged in. Please run 'az login' first")
	}
	
	// Get user inputs for VM creation
	var username, cpImageVersion, workerImageVersion string
	
	fmt.Print("   Enter username prefix for VM naming: ")
	fmt.Scanln(&username)
	
	fmt.Print("   Enter control-plane image version (e.g., 2025.19.08190213) or press Enter for latest: ")
	fmt.Scanln(&cpImageVersion)
	
	fmt.Print("   Enter worker image version (e.g., 2025.19.08190213) or press Enter for latest: ")
	fmt.Scanln(&workerImageVersion)
	
	// VM configuration
	config := VMConfig{
		SubscriptionID: "1630c6a9-d99b-498a-aca8-a271f7506bc0",
		ResourceGroup:  "datamigrate-acr-resource-group",
		Location:       "eastus",
		VNetName:       "datamigrate-dev-vnet",
		SubnetName:     "default",
		GalleryName:    "datamigrator",
		AdminUsername:  "ubuntu",
		AdminPassword:  "Password@123",
		Username:       username,
	}
	
	// Set subscription
	fmt.Printf("   🔧 Setting Azure subscription...\n")
	cmd = exec.Command("az", "account", "set", "--subscription", config.SubscriptionID)
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("failed to set subscription: %v", err)
	}
	
	// Create Control Plane VM
	cpConfig := config
	cpConfig.VMType = "control-plane"
	cpConfig.VMName = fmt.Sprintf("%s-cp-azure-automated", username)
	cpConfig.ImageVersion = cpImageVersion
	
	fmt.Printf("   🔧 Creating Control Plane VM: %s\n", cpConfig.VMName)
	fmt.Printf("   📦 CP Image Version: %s\n", cpConfig.ImageVersion)
	
	cpIP, err := createSingleVMAndGetIP(cpConfig)
	if err != nil {
		return "", "", fmt.Errorf("failed to create Control Plane VM: %v", err)
	}
	
	// Create Worker VM
	workerConfig := config
	workerConfig.VMType = "worker"
	workerConfig.VMName = fmt.Sprintf("%s-worker-azure-automated", username)
	workerConfig.ImageVersion = workerImageVersion
	
	fmt.Printf("   🔧 Creating Worker VM: %s\n", workerConfig.VMName)
	fmt.Printf("   📦 Worker Image Version: %s\n", workerConfig.ImageVersion)
	
	workerIP, err := createSingleVMAndGetIP(workerConfig)
	if err != nil {
		return "", "", fmt.Errorf("failed to create Worker VM: %v", err)
	}
	
	fmt.Println("   ✅ Both VMs created successfully!")
	fmt.Printf("   📡 Control Plane IP: %s\n", cpIP)
	fmt.Printf("   👷 Worker IP: %s\n", workerIP)
	
	return cpIP, workerIP, nil
}

// VMConfig represents VM configuration
type VMConfig struct {
	VMName         string
	VMType         string
	ImageVersion   string
	Username       string
	SubscriptionID string
	ResourceGroup  string
	Location       string
	VNetName       string
	SubnetName     string
	GalleryName    string
	AdminUsername  string
	AdminPassword  string
}

// createSingleVMAndGetIP creates a single VM using Azure CLI and returns its IP
func createSingleVMAndGetIP(config VMConfig) (string, error) {
	// Get image ID
	imageID, err := getImageIDForVM(config)
	if err != nil {
		return "", fmt.Errorf("failed to get image ID: %v", err)
	}
	
	// Get subnet ID
	subnetID, err := getSubnetIDForVM(config)
	if err != nil {
		return "", fmt.Errorf("failed to get subnet ID: %v", err)
	}
	
	// Get VM size
	vmSize := getVMSizeForVM(config.VMType)
	
	// Create VM
	fmt.Printf("      📡 Creating %s VM...\n", config.VMType)
	cmd := exec.Command("az", "vm", "create",
		"--resource-group", config.ResourceGroup,
		"--name", config.VMName,
		"--image", imageID,
		"--size", vmSize,
		"--admin-username", config.AdminUsername,
		"--admin-password", config.AdminPassword,
		"--authentication-type", "password",
		"--subnet", subnetID,
		"--location", config.Location,
		"--zone", "1",
		"--storage-sku", "Premium_LRS",
		"--os-disk-size-gb", "200",
		"--security-type", "TrustedLaunch",
		"--enable-secure-boot", "true",
		"--enable-vtpm", "true",
		"--nic-delete-option", "Delete",
		"--os-disk-delete-option", "Delete",
		"--public-ip-address", "",
		"--tags", "environment=dev", "owner="+config.Username,
		"--output", "json")
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("VM creation failed: %v\nOutput: %s", err, output)
	}
	
	fmt.Printf("      ✅ %s VM created successfully!\n", config.VMType)
	
	// Get the private IP of the created VM
	fmt.Printf("      🔍 Getting IP address for %s...\n", config.VMName)
	cmd = exec.Command("az", "vm", "show",
		"--resource-group", config.ResourceGroup,
		"--name", config.VMName,
		"--show-details",
		"--query", "privateIps",
		"--output", "tsv")
	
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get VM IP: %v", err)
	}
	
	ip := strings.TrimSpace(string(output))
	if ip == "" {
		return "", fmt.Errorf("no private IP found for VM: %s", config.VMName)
	}
	
	fmt.Printf("      📍 %s IP: %s\n", config.VMType, ip)
	return ip, nil
}

// createSingleVM creates a single VM using Azure CLI (kept for backwards compatibility)
func createSingleVM(config VMConfig) error {
	_, err := createSingleVMAndGetIP(config)
	return err
}

// getImageIDForVM gets the image ID for VM creation
func getImageIDForVM(config VMConfig) (string, error) {
	var imageDefinition string
	if config.VMType == "control-plane" {
		imageDefinition = "ndm-control-plane"
	} else {
		imageDefinition = "ndm-worker"
	}
	
	if config.ImageVersion == "" {
		// Get latest version
		cmd := exec.Command("az", "sig", "image-version", "list",
			"--resource-group", config.ResourceGroup,
			"--gallery-name", config.GalleryName,
			"--gallery-image-definition", imageDefinition,
			"--query", "[0].id",
			"--output", "tsv")
		
		output, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("failed to get latest image: %v", err)
		}
		return strings.TrimSpace(string(output)), nil
	} else {
		// Get specific version
		cmd := exec.Command("az", "sig", "image-version", "show",
			"--resource-group", config.ResourceGroup,
			"--gallery-name", config.GalleryName,
			"--gallery-image-definition", imageDefinition,
			"--gallery-image-version", config.ImageVersion,
			"--query", "id",
			"--output", "tsv")
		
		output, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("failed to get image version %s: %v", config.ImageVersion, err)
		}
		return strings.TrimSpace(string(output)), nil
	}
}

// getSubnetIDForVM gets the subnet ID for VM creation
func getSubnetIDForVM(config VMConfig) (string, error) {
	cmd := exec.Command("az", "network", "vnet", "subnet", "show",
		"--resource-group", config.ResourceGroup,
		"--vnet-name", config.VNetName,
		"--name", config.SubnetName,
		"--query", "id",
		"--output", "tsv")
	
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get subnet ID: %v", err)
	}
	return strings.TrimSpace(string(output)), nil
}

// getVMSizeForVM returns the appropriate VM size for the VM type
func getVMSizeForVM(vmType string) string {
	switch vmType {
	case "control-plane":
		return "Standard_D8s_v3" // 8 vCPUs, 32 GB RAM
	case "worker":
		return "Standard_D4s_v3" // 4 vCPUs, 16 GB RAM
	default:
		return "Standard_D4s_v3"
	}
}

// updateEnvFile updates the .env file with new IP addresses
func updateEnvFile(cpIP, workerIP string) error {
	envPaths := []string{".env", "../.env", "../../.env"}
	
	for _, envPath := range envPaths {
		if _, err := os.Stat(envPath); err == nil {
			return updateEnvFileAtPath(envPath, cpIP, workerIP)
		}
	}
	
	return fmt.Errorf("no .env file found")
}

// updateEnvFileAtPath updates a specific .env file
func updateEnvFileAtPath(envPath, cpIP, workerIP string) error {
	// Read the current file
	content, err := os.ReadFile(envPath)
	if err != nil {
		return fmt.Errorf("failed to read .env file: %v", err)
	}
	
	envContent := string(content)
	
	// Update the environment variables
	replacements := map[string]string{
		"AZ_JOB_SERVICE_URL=https://": "AZ_JOB_SERVICE_URL=https://" + cpIP,
		"AZ_CONFIG_SERVICE_URL=https://": "AZ_CONFIG_SERVICE_URL=https://" + cpIP,
		"AZ_ADMIN_SERVICE_URL=https://": "AZ_ADMIN_SERVICE_URL=https://" + cpIP,
		"AZ_KEYCLOAK_IP=": "AZ_KEYCLOAK_IP=" + cpIP,
		"AZ_NDM_VM_HOST=": "AZ_NDM_VM_HOST=" + cpIP,
		"AZ_NDM_WORKERS_HOST=": `AZ_NDM_WORKERS_HOST="` + workerIP + `"`,
	}
	
	for pattern, replacement := range replacements {
		lines := strings.Split(envContent, "\n")
		for i, line := range lines {
			if strings.HasPrefix(line, pattern) {
				lines[i] = replacement
			}
		}
		envContent = strings.Join(lines, "\n")
	}
	
	// Write back to file
	err = os.WriteFile(envPath, []byte(envContent), 0644)
	if err != nil {
		return fmt.Errorf("failed to write .env file: %v", err)
	}
	
	return nil
}

// waitForControlPlaneReadyWithIP waits for the Control Plane to be fully ready using provided IP
func waitForControlPlaneReadyWithIP(cpIP string) error {
	fmt.Printf("   🎯 Monitoring Control Plane at: %s\n", cpIP)
	
	// Record start time
	startTime := time.Now()
	fmt.Printf("   ⏰ Starting monitoring at: %s\n", startTime.Format("15:04:05"))
	
	// Step 1: Wait for ping response
	fmt.Println("   📡 Waiting for VM to be pingable...")
	var firstPingTime time.Time
	for i := 0; i < 60; i++ { // Wait up to 5 minutes
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
	
	// Step 2: Wait for HTTP response and full UI availability (30-60 minutes)
	fmt.Println("   🌐 Waiting for Control Plane UI to be fully ready...")
	fmt.Println("   ⏰ This can take 30-60 minutes for first-time boot...")
	url := fmt.Sprintf("https://%s", cpIP)
	
	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	
	maxWaitMinutes := 60 // Wait up to 1 hour
	maxAttempts := maxWaitMinutes * 12 // 5-second intervals = 12 per minute
	
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
				// Only log every 5 minutes to reduce noise
				if i%60 == 0 {
					fmt.Printf("   ⏳ Status: %d (services still starting up... %d/%d minutes, total elapsed: %v)\n", 
						resp.StatusCode, i/12+1, maxWaitMinutes, totalElapsed)
				}
			} else {
				fmt.Printf("   ⚠️  Unexpected status: %d (Total elapsed: %v)\n", resp.StatusCode, totalElapsed)
			}
		} else {
			// Only log connection errors every 10 minutes
			if i%120 == 0 {
				fmt.Printf("   🔌 Connection attempt %d/%d (total elapsed: %v, still waiting for services...)\n", 
					i/12+1, maxWaitMinutes, totalElapsed)
			}
		}
		
		time.Sleep(5 * time.Second)
		
		// Progress updates every 5 minutes with timing
		if i%60 == 0 && i > 0 {
			fmt.Printf("   ⏳ Still waiting... (%d/%d minutes, total elapsed: %v, since ping: %v) - NDM services are starting up\n", 
				i/12, maxWaitMinutes, totalElapsed, sincePing)
		}
		
		// Helpful message at 15 and 30 minute marks with timing
		if i == 180 { // 15 minutes
			fmt.Printf("   💡 15 minutes elapsed (total: %v). NDM boot process typically takes 20-45 minutes...\n", totalElapsed)
		}
		if i == 360 { // 30 minutes
			fmt.Printf("   💡 30 minutes elapsed (total: %v). This is normal for first-time boot. Continuing to wait...\n", totalElapsed)
		}
	}
	
	finalElapsed := time.Now().Sub(startTime)
	return fmt.Errorf("Control Plane UI did not become ready within %d minutes (total elapsed: %v)", maxWaitMinutes, finalElapsed)
}

// waitForControlPlaneReady waits for the Control Plane to be fully ready (kept for backwards compatibility)
func waitForControlPlaneReady() error {
	// First, get the CP IP from environment
	cpIP := os.Getenv("AZ_KEYCLOAK_IP")
	if cpIP == "" {
		return fmt.Errorf("AZ_KEYCLOAK_IP environment variable not set")
	}
	
	return waitForControlPlaneReadyWithIP(cpIP)
}
