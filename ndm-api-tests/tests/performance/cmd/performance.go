package main

import (
	"crypto/tls"
	// "encoding/json"
	"fmt"
	// "io"
	"log"
	"net/http"
	"os"
	"os/exec"

	// "runtime"
	"strings"
	"time"

	. "ndm-api-tests/utils"
	// "github.com/shirou/gopsutil/cpu"
	// "github.com/shirou/gopsutil/v3/disk"
	// "github.com/shirou/gopsutil/disk"
	// "github.com/shirou/gopsutil/v3/cpu"
	// "github.com/shirou/gopsutil/cpu"
	// "github.com/shirou/gopsutil/v3/disk"
	// // "github.com/shirou/gopsutil/v3/cpu"
	// // "github.com/shirou/gopsutil/v3/disk"
	// "github.com/shirou/gopsutil/v3/mem"
	// "github.com/shirou/gopsutil/v3/net"
)

func main() {

	fmt.Println("\n====================Creating Azure VMs====================")
	// cpIP, workerIP, err := createAzureVMs()
	// cpIP, workerIP := "172.30.203.12", "172.30.203.17"
	// var err error = nil
	cpIP := "172.30.203.24"
	workerIP := "172.30.203.25"
	var err error = nil
	if err != nil {
		log.Fatalf("Failed to create Azure VMs: %v", err)
	}
	// fmt.Println("Created VM as simulation")

	fmt.Println("\n====================Updating Environment Variables=====================")
	err = updateEnvVariables(cpIP, workerIP)
	if err != nil {
		log.Printf("Failed to update environment variables: %v", err)
	}

	fmt.Println("\nEnvironment Variables after loading:")
	fmt.Printf("===>NDM_VM_HOST: %s\n", NDM_VM_HOST)
	fmt.Printf("===>NDM_WORKERS_HOST: %s\n", NDM_WORKERS_HOST)

	// Initialize protocol/environment-specific config variables

	fmt.Println("\n====================Waiting for Control Plane to be UP====================")
	err = waitForControlPlaneReadyWithIP(cpIP)
	if err != nil {
		log.Printf("Control Plane readiness check failed: %v", err)
	}

	fmt.Println("\n====================Initialising the User====================")

	InitTestEnv()
	fmt.Printf("NDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)

	fmt.Println("\n====================Create Project and Attaching the worker(s)====================")
	workerCount := len(os.Getenv("AZ_NDM_WORKER_COUNT"))
	projectId, workersConfig, err := SetupTestEnv(workerCount)
	if err != nil {
		fmt.Printf("Failed to setup test environment: %v\n", err)
		return
	}
	fmt.Printf("======>Project ID: %s\n", projectId)
	fmt.Printf("======>Workers attached: %d\n", len(workersConfig))

	for workerName, config := range workersConfig {
		fmt.Printf("   Worker: %s (Host: %s:%d)\n", workerName, config.Host, config.Port)
	}
	fmt.Printf("NDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)
	// fmt.Println("\n====================Starting Metrics Collection====================")

	// // Start collecting LOCAL automation host metrics (where this Go script runs)
	// // This monitors the machine running the automation, NOT the worker VM
	// fmt.Println("Starting local automation host metrics collection...")
	// // go LogSystemMetricsToFile("automation_host_metrics.json")

	// // Start fetching worker VM metrics from Prometheus Pushgateway after workers are attached
	// // NDM worker pushes metrics to Pushgateway on control plane at port 9091
	// fmt.Println("Starting worker VM metrics collection from Pushgateway...")
	// // workerMetricsEndpoint := "http://" + cpIP + ":9091/metrics"
	// // go LogNodeMetricsToFile(workerMetricsEndpoint, "worker_vm_metrics.log")

	// // Give metrics collection a moment to initialize
	// time.Sleep(2 * time.Second)

	// Setup source file server
	fmt.Println("\n====================Setting up File Servers====================")
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  "application/json",
	}
	workerIds := GetWorkerIds()
	if len(workerIds) == 0 {
		fmt.Printf("******No worker IDs available for project %s******\n", projectId)
		return
	}
	sourceParams := CreateServereParams{
		ConfigName:       "Source-FileServer-Performance-Test",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         NDM_VM_USER_NAME, // From AZ_NDM_VM_USER_NAME
		Password:         NDM_VM_PASSWORD,  // From AZ_NDM_VM_PASSWORD
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             SOURCE_HOST_IP, // From AZ_SOURCE_HOST_IP (10.0.0.169)
		Workers:          workerIds,
		WorkingDirectory: "/tmp",
		ExportPathSource: nil, // Will use AutoDiscover default from file_server.go
	}
	sourceFileServerId, resp, err := CreateFileServer(sourceParams, headers)
	if err != nil {
		fmt.Printf("Failed to create source file server: %v\n", err)
		return
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		fmt.Printf("Source file server creation failed with status: %d\n", resp.StatusCode)
		return
	}

	// Discovery job for source file server
	log.Printf("\n==================== CREATING DISCOVERY JOB ====================")
	sourceExportPath := "/mnt/data/AI" // Use the same path as migration source
	sourceExportPathID, err := GetExportPathID("source", sourceExportPath, sourceFileServerId, headers)
	if err != nil {
		LogFatalf("Error getting source export path ID for discovery job: %v", err)
	}
	sourcePathIDs := []string{sourceExportPathID}
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
	var sourceJobConfigIDs interface{}
	sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
	if err != nil {
		LogFatalf("Error creating discovery job: %v", err)
	}
	defer resp.Body.Close()
	log.Printf("Source discovery job created with config IDs: %s", sourceJobConfigIDs)

	fmt.Printf("======>Source file Server ID: %s\n", sourceFileServerId)
	destinationParams := CreateServereParams{
		ConfigName:       "Destination-FileServer-Performance-Test",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         NDM_VM_USER_NAME, // From AZ_NDM_VM_USER_NAME
		Password:         NDM_VM_PASSWORD,  // From AZ_NDM_VM_PASSWORD
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             DESTINATION_HOST_IP, // From AZ_DESTINATION_HOST_IP (10.0.4.9)
		Workers:          workerIds,
		WorkingDirectory: "/tmp",
		ExportPathSource: nil, // Will use AutoDiscover default
	}
	destinationFileServerId, _, err := CreateFileServer(destinationParams, headers)
	if err != nil {
		fmt.Printf("Failed to create destination file server: %v\n", err)
		return
	}
	fmt.Printf("======>Destination file Server ID: %s\n", destinationFileServerId)

	// Create migration job from /mnt/data/AI (source) to /KB-NFS-PERF-AUTO-VOL (destination)
	fmt.Println("\n====================Setting Up Migration Job====================")
	err = setupMigrationJob(sourceFileServerId, destinationFileServerId, "/mnt/data/AI", "/KB-NFS-PERF-AUTO-VOL", headers)
	if err != nil {
		fmt.Printf("Warning: Failed to setup migration job: %v\n", err)
	}

	fmt.Println("\nNDM Performance Test Environment is ready for testing!")
	fmt.Println("Ready for data migration performance tests!")
	fmt.Printf("Source Host: %s\n", SOURCE_HOST_IP)
	fmt.Printf("Source File Server ID: %s\n", sourceFileServerId)
	if DESTINATION_HOST_IP != "" {
		fmt.Printf("Destination Host: %s\n", DESTINATION_HOST_IP)
		fmt.Printf("Destination Volume: %s:/kb-vol-perf-run\n", DESTINATION_HOST_IP)
	}

	// Wait for interrupt signal to gracefully shutdown
	// fmt.Println("\n📊 Metrics collection is running in background...")
	// fmt.Println("💡 Press Ctrl+C to stop metrics collection and exit")

	// // Set up signal channel
	// sigChan := make(chan os.Signal, 1)
	// signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// // Block until signal received
	// <-sigChan
	// fmt.Println("\n🛑 Received shutdown signal. Stopping metrics collection...")
	// fmt.Println("✅ Metrics collection stopped. Files saved:")
	// fmt.Println("   📄 automation_host_metrics.json")
	// fmt.Println("   📄 worker_vm_metrics.log")
	// fmt.Println("👋 Goodbye!")

	fmt.Printf("NDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)
}

// setupMigrationJob creates a migration job from source to destination/mnt/data/AI/KB-NFS-PERF-AUTO-VOL
func setupMigrationJob(sourceFileServerId, destinationFileServerId, srcpath, destpath string, headers map[string]string) error {
	// Get source path ID for /mnt/data/AI
	sourcePathId, err := GetExportPathID("source", srcpath, sourceFileServerId, headers)
	if err != nil {
		return fmt.Errorf("failed to get source path ID: %w", err)
	}
	destinationPathId, err := GetExportPathID("destination", destpath, destinationFileServerId, headers)
	if err != nil {
		return fmt.Errorf("failed to get destination path ID: %w", err)
	}
	migrationParams := MigrationJobParams{
		FirstRunAt:         GetCurrentUTCTimestamp(),
		FutureRunSchedule:  "",
		SourcePathIDs:      []string{sourcePathId},
		DestinationPathIDs: []string{destinationPathId},
		SidMapping:         false,
		Options: map[string]interface{}{
			"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
			"preserveAccessTime":  true,
			"skipFile":            "0-M",
		},
	}
	fmt.Println("=====>Triggering migration job")
	jobIds, resp, err := CreateMigrationJob(migrationParams, headers)
	if err != nil {
		return fmt.Errorf("failed to create migration job: %w", err)
	}

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("migration job creation failed with status: %d", resp.StatusCode)
	}

	if len(jobIds) > 0 {
		fmt.Printf("========>Migration job created successfully with ID: %s\n", jobIds[0])
		fmt.Printf("========>Migration: %s:/mnt/data/AI → %s:/KB-NFS-PERF-AUTO-VOL\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)

		// Start direct system metrics logging in background (gopsutil)
		// go LogSystemMetricsToFile("system_metrics.log")
		// // Fetch and log worker VM metrics from its Prometheus endpoint
		// workerMetricsEndpoint := "http://" + NDM_WORKERS_HOST + ":9100/metrics"
		// go LogNodeMetricsToFile(workerMetricsEndpoint, "worker_metrics.log")

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
			fmt.Printf("Job Run ID: %s\n", jobRunID)
			fmt.Printf("Job Status: %s\n", getJobsResp.JobRuns[0].Status)
			fmt.Println("Waiting for migration job to start...")
			err = WaitForJobState(jobRunID, RUNNING_JOBRUN)
			if err != nil {
				fmt.Printf("Warning: Job may not have started yet: %v\n", err)
			} else {
				fmt.Printf("=============Migration job is now RUNNING=============\n")
			}
		}
	} else {
		return fmt.Errorf("no job IDs returned from migration job creation")
	}

	if err != nil {
		return fmt.Errorf("failed to create migration job: %w", err)
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("migration job creation failed with status: %d", resp.StatusCode)
	}

	if len(jobIds) > 0 {
		fmt.Printf("========>Migration job created successfully with ID: %s\n", jobIds[0])
		fmt.Printf("========>Migration: %s:/mnt/data/AI → %s:/KB-NFS-PERF-AUTO-VOL\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)

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
			fmt.Printf("Job Run ID: %s\n", jobRunID)
			fmt.Printf("Job Status: %s\n", getJobsResp.JobRuns[0].Status)
			fmt.Println("Waiting for migration job to start...")
			err = WaitForJobState(jobRunID, RUNNING_JOBRUN)
			if err != nil {
				fmt.Printf("Warning: Job may not have started yet: %v\n", err)
			} else {
				fmt.Printf("=============Migration job is now RUNNING=============\n")
			}
		}
	} else {
		return fmt.Errorf("no job IDs returned from migration job creation")
	}

	return nil
}

func createAzureVMs() (string, string, error) {
	cmd := exec.Command("az", "account", "show")
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("*********azure CLI not logged in. Please run 'az login' first*********")
	}
	var username, cpImageVersion, workerImageVersion string
	fmt.Print(">>>>>>>>>Enter username prefix for VM naming: ")
	fmt.Scanln(&username)
	fmt.Print(">>>>>>>>>Enter control-plane image version (e.g., 2025.19.08190213) or press Enter for latest: ")
	fmt.Scanln(&cpImageVersion)
	fmt.Print(">>>>>>>>>Enter worker image version (e.g., 2025.19.08185924) or press Enter for latest: ")
	fmt.Scanln(&workerImageVersion)
	config := VMConfig{
		SubscriptionID: "1630c6a9-d99b-498a-aca8-a271f7506bc0",
		ResourceGroup:  "MigrationAsAService-dev-infra",
		Location:       "eastus2",
		VNetName:       "MigrationAsAService-dev-VNET02",
		SubnetName:     "MigrationAsAService-dev-VNET02_Subnet01",
		GalleryName:    "datamigrator",
		AdminUsername:  "ubuntu",
		AdminPassword:  "Password@123",
		Username:       username,
	}
	cmd = exec.Command("az", "account", "set", "--subscription", config.SubscriptionID)
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("*********failed to set subscription: %v*********", err)
	}

	// Control Plane VM configuration
	cpConfig := config
	cpConfig.VMType = "control-plane"
	cpConfig.VMName = fmt.Sprintf("%s-cp-azure-automated-perf-%s", username, time.Now().Format("20060102-150405"))
	cpConfig.ImageVersion = cpImageVersion
	cpIP, err := createSingleVMAndGetIP(cpConfig)
	if err != nil {
		return "", "", fmt.Errorf("*********failed to create Control Plane VM: %v*********", err)
	}

	// Create Worker VM
	workerConfig := config
	workerConfig.VMType = "worker"
	workerConfig.VMName = fmt.Sprintf("%s-worker-azure-automated-perf-%s", username, time.Now().Format("20060102-150405"))
	workerConfig.ImageVersion = workerImageVersion
	workerIP, err := createSingleVMAndGetIP(workerConfig)
	if err != nil {
		return "", "", fmt.Errorf("*********failed to create Worker VM: %v*********", err)
	}

	fmt.Println("=======>Both VMs created successfully!")
	fmt.Printf("Control Plane IP: %s\n", cpIP)
	fmt.Printf("Worker IP: %s\n", workerIP)
	return cpIP, workerIP, nil
}

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

func createSingleVMAndGetIP(config VMConfig) (string, error) {
	// Get image ID
	imageID, err := getImageIDForVM(config)
	if err != nil {
		return "", fmt.Errorf("***********failed to get image ID: %v***********", err)
	}

	// Get subnet ID
	subnetID, err := getSubnetIDForVM(config)
	if err != nil {
		return "", fmt.Errorf("***********failed to get subnet ID: %v***********", err)
	}

	// Get VM size
	vmSize := getVMSizeForVM(config.VMType)
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
		return "", fmt.Errorf("***********VM creation failed: %v***********\nOutput: %s", err, output)
	}
	cmd = exec.Command("az", "vm", "show",
		"--resource-group", config.ResourceGroup,
		"--name", config.VMName,
		"--show-details",
		"--query", "privateIps",
		"--output", "tsv")
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("***********failed to get VM IP: %v***********", err)
	}
	ip := strings.TrimSpace(string(output))
	if ip == "" {
		return "", fmt.Errorf("no private IP found for VM: %s", config.VMName)
	}
	return ip, nil
}
func getImageIDForVM(config VMConfig) (string, error) {
	var imageDefinition string
	if config.VMType == "control-plane" {
		imageDefinition = "ndm-control-plane"
	} else {
		imageDefinition = "ndm-worker"
	}

	sourceImageResourceGroup := "datamigrate-acr-resource-group"
	if config.ImageVersion == "" {
		// Get latest version from source resource group
		cmd := exec.Command("az", "sig", "image-version", "list",
			"--resource-group", sourceImageResourceGroup,
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
		// Get specific version from source resource group
		cmd := exec.Command("az", "sig", "image-version", "show",
			"--resource-group", sourceImageResourceGroup,
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
func updateEnvVariables(cpIP, workerIP string) error {

	// Set all required environment variables directly
	os.Setenv("JOB_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("CONFIG_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("ADMIN_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("REPORT_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("KEYCLOAK_IP", cpIP)
	os.Setenv("NDM_USERNAME", "admin@datamigrator.local")
	os.Setenv("PASSWORD", "Welcome@123")
	os.Setenv("NDM_VM_USER_NAME", "ubuntu")
	os.Setenv("NDM_VM_HOST", cpIP)
	os.Setenv("NDM_VM_PORT", "22")
	os.Setenv("NDM_VM_PASSWORD", "Password@123")
	os.Setenv("AZ_NDM_VM_HOST", cpIP)
	os.Setenv("AZ_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZ_NDM_WORKER_COUNT", "1")
	os.Setenv("AZ_NDM_WORKERS_USER_NAME", "ubuntu")
	os.Setenv("AZ_NDM_WORKERS_PORT", "22")
	os.Setenv("AZ_NDM_WORKERS_PASSWORD", "Password@123")
	os.Setenv("AZ_SOURCE_HOST_IP", "172.30.203.23")
	os.Setenv("AZ_DESTINATION_HOST_IP", "172.30.202.27")
	os.Setenv("AZURE_NFS_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZURE_NFS_NDM_WORKERS_USER_NAME", "ubuntu")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PORT", "22")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PASSWORD", "Password@123")
	os.Setenv("AZURE_NFS_SOURCE_VOLUMES", "/mnt/data/AI")
	os.Setenv("AZURE_NFS_DESTINATION_VOLUMES", "/KB-NFS-PERF-AUTO-VOL")
	os.Setenv("AZURE_NFS_SOURCE_HOST_IP", "172.30.203.23")
	os.Setenv("AZURE_NFS_DESTINATION_HOST_IP", "172.30.202.27")
	os.Setenv("AZURE_NFS_PROTOCOL_USERNAME", "ubuntu")
	os.Setenv("AZURE_NFS_PROTOCOL_PASSWORD", "Password@123")

	// Set key config variables directly after env setup
	JOB_SERVICE_URL = os.Getenv("JOB_SERVICE_URL")
	CONFIG_SERVICE_URL = os.Getenv("CONFIG_SERVICE_URL")
	ADMIN_SERVICE_URL = os.Getenv("ADMIN_SERVICE_URL")
	REPORT_SERVICE_URL = os.Getenv("REPORT_SERVICE_URL")
	KEYCLOAK_IP = os.Getenv("KEYCLOAK_IP")
	USERNAME = os.Getenv("NDM_USERNAME")
	PASSWORD = os.Getenv("PASSWORD")
	NDM_VM_USER_NAME = os.Getenv("NDM_VM_USER_NAME")
	NDM_VM_HOST = os.Getenv("NDM_VM_HOST")
	NDM_VM_PORT = os.Getenv("NDM_VM_PORT")
	NDM_VM_PASSWORD = os.Getenv("NDM_VM_PASSWORD")

	UpdateConfVariables(string(ProtocolNFS), string(AzureEnv))
	return nil
}

func waitForControlPlaneReadyWithIP(cpIP string) error {
	fmt.Printf("   🎯 Monitoring Control Plane at: %s\n", cpIP)
	startTime := time.Now()
	fmt.Printf("====>Starting monitoring at: %s\n", startTime.Format("15:04:05"))
	fmt.Println("====>Waiting for VM to be pingable")
	var firstPingTime time.Time
	for i := 0; i < 60; i++ { // Wait up to 5 minutes
		cmd := exec.Command("ping", "-c", "1", cpIP)
		if cmd.Run() == nil {
			firstPingTime = time.Now()
			pingDuration := firstPingTime.Sub(startTime)
			fmt.Printf("====>VM is now pingable! (%v)\n", pingDuration)
			fmt.Printf("First ping successful at: %s\n", firstPingTime.Format("15:04:05"))
			break
		}
		if i == 59 {
			return fmt.Errorf("VM not pingable trying after 5 minutes")
		}
		time.Sleep(5 * time.Second)
		fmt.Print(".")
	}

	// Step 2: Wait for HTTP response and full UI availability (30-60 minutes)
	fmt.Println("===>Waiting for Control Plane UI to be fully ready...")
	fmt.Println("===>This can take 30-60 minutes for first-time boot...")
	url := fmt.Sprintf("https://%s", cpIP)

	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	maxWaitMinutes := 60               // Wait up to 1 hour
	maxAttempts := maxWaitMinutes * 12 // 5-second intervals = 12 per minute

	for i := 0; i < maxAttempts; i++ {
		currentTime := time.Now()
		totalElapsed := currentTime.Sub(startTime)
		sincePing := currentTime.Sub(firstPingTime)

		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				fmt.Printf("===>Control Plane UI is fully ready! (Total time: %v, Since ping: %v)\n",
					totalElapsed, sincePing)
				fmt.Printf("===>UI ready at: %s\n", currentTime.Format("15:04:05"))
				fmt.Println("Waiting 5 minutes for services to finish setup...")
				time.Sleep(5 * time.Minute)
				return nil
			} else if resp.StatusCode == 404 || resp.StatusCode == 503 {
				// Only log every 5 minutes to reduce noise
				if i%60 == 0 {
					fmt.Printf("====>Status: %d (services still starting up... %d/%d minutes, total elapsed: %v)\n",
						resp.StatusCode, i/12+1, maxWaitMinutes, totalElapsed)
				}
			} else {
				fmt.Printf("====>Unexpected status: %d (Total elapsed: %v)\n", resp.StatusCode, totalElapsed)
			}
		} else {
			// Only log connection errors every 10 minutes
			if i%120 == 0 {
				fmt.Printf("====>Connection attempt %d/%d (total elapsed: %v, still waiting for services...)\n",
					i/12+1, maxWaitMinutes, totalElapsed)
			}
		}

		time.Sleep(5 * time.Second)

		// Progress updates every 5 minutes with timing
		if i%60 == 0 && i > 0 {
			fmt.Printf("====>Still waiting... (%d/%d minutes, total elapsed: %v, since ping: %v) - NDM services are starting up\n",
				i/12, maxWaitMinutes, totalElapsed, sincePing)
		}

		// Helpful message at 15 and 30 minute marks with timing
		if i == 180 { // 15 minutes
			fmt.Printf("====>15 minutes elapsed (total: %v). NDM boot process typically takes 20-45 minutes...\n", totalElapsed)
		}
		if i == 360 { // 30 minutes
			fmt.Printf(" ====> 30 minutes elapsed (total: %v). This is normal for first-time boot. Continuing to wait...\n", totalElapsed)
		}
	}

	finalElapsed := time.Since(startTime)
	return fmt.Errorf("control plane UI did not become ready within %d minutes (total elapsed: %v)", maxWaitMinutes, finalElapsed)

}
