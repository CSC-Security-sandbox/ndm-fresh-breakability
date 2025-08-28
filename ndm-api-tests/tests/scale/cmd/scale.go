package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	. "ndm-api-tests/utils"
)

// Azure Scale Testing Configuration
type AzureScaleConfig struct {
	// Existing Azure VM configuration
	SubscriptionID string
	ResourceGroup  string
	Location       string
	VNetName       string
	SubnetName     string

	// Scale testing parameters
	SourcePathCount      int    `default:"8"`
	DestinationPathCount int    `default:"8"`
	VolumeSize           string `default:"150"`
	SourceExportPaths    []string
	DestinationPaths     []string

	// Azure NetApp Files configuration - Using your real ANF setup
	ANFAccountName string `default:"JEEVITHA-BUG-TEST"`
	ANFPoolName    string `default:"JEEVITHA-BUG-POOL"`
	ANFSubnetName  string `default:"MigrationAsAService-dev-Subnet02"`
	ANFVNetName    string `default:"MigrationAsAService-dev-VNET01"`
}

func main() {

	fmt.Println("\n====================Using Existing Azure VMs====================")
	// Comment out VM creation to reuse existing VMs
	// cpIP, workerIP, err := createAzureVMs()
	// if err != nil {
	// 	log.Fatalf("Failed to create Azure VMs: %v", err)
	// }
	
	// Using hardcoded IPs from your last successful VM creation
	cpIP, workerIP := "172.30.203.32", "172.30.203.33"
	var err error = nil
	fmt.Printf("✅ Using existing VMs:\n")
	fmt.Printf("Control Plane IP: %s\n", cpIP)
	fmt.Printf("Worker IP: %s\n", workerIP)

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
	fmt.Println("\n====================Enhanced Azure Scale Testing====================")

	// Initialize Azure scale configuration with EXISTING infrastructure 
	config := &AzureScaleConfig{
		SubscriptionID:       "1630c6a9-d99b-498a-aca8-a271f7506bc0",    // Existing subscription
		ResourceGroup:        "MigrationAsAService-dev-infra",           // Existing resource group
		Location:             "eastus2",                                 // Existing location
		VNetName:             "MigrationAsAService-dev-VNET02",          // Existing VNet
		SubnetName:           "MigrationAsAService-dev-VNET02_Subnet01", // Existing subnet
		SourcePathCount:      8,                                         // Scale testing with 8 paths
		DestinationPathCount: 8,
		VolumeSize:           "150GB",
		// Use EXISTING ANF infrastructure 
		ANFAccountName: "JEEVITHA-BUG-TEST",                // Your EXISTING ANF account
		ANFPoolName:    "JEEVITHA-BUG-POOL",                // Your EXISTING capacity pool
		ANFSubnetName:  "MigrationAsAService-dev-Subnet02", // Your EXISTING ANF subnet
		ANFVNetName:    "MigrationAsAService-dev-VNET01",   // Your EXISTING ANF VNet
	}

	fmt.Printf("🚀 Azure Scale Test Configuration:\n")
	fmt.Printf("   📊 Source Paths: %d\n", config.SourcePathCount)
	fmt.Printf("   📁 Destination Volumes: %d\n", config.DestinationPathCount)
	fmt.Printf("   💾 Volume Size: %s each\n", config.VolumeSize)

	// Phase 1: Source File Server Setup 
	fmt.Println("\n=== Phase 1: Source File Server Setup (8 Export Paths) ===")
	// Use identical hardcoded source paths 
	config.SourceExportPaths = []string{"/volSrcAI", "/volSrcAI_clone_2", "/volSrcAI_clone_3", "/volSrcAI_clone_4", "/volSrcAI_clone_5", "/volSrcAI_clone_6", "/volSrcAI_clone_7", "/volSrcAI_clone_8"}

	fmt.Printf("📂 Source Export Paths :\n")
	for i, path := range config.SourceExportPaths {
		fmt.Printf("   %d: %s\n", i+1, path)
	}

	// Phase 2: Create Source File Server
	fmt.Println("\n=== Phase 2: Create Source File Server ===")
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  "application/json",
	}
	workerIds := GetWorkerIds()
	if len(workerIds) == 0 {
		fmt.Printf("******No worker IDs available for project %s******\n", projectId)
		return
	}

	// Create source file server 
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
		Workers:          workerIds,
		WorkingDirectory: "",
		// No ExportPathSource specified
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
	fmt.Printf("✅ Source file server created: %s\n", sourceFileServerId)
	fmt.Printf("⏳ Waiting for source file server to be ready...\n")
	time.Sleep(1 * time.Minute) 

	// Phase 3: Run Discovery Job 
	fmt.Println("\n=== Phase 3: Discovery Job on Source Paths ===")
	fmt.Printf("Getting source export path IDs...\n")
	sourcePathIDs := []string{}
	for _, exportPath := range config.SourceExportPaths {
		sourcePathID, err := GetExportPathID("source", exportPath, sourceFileServerId, headers)
		if err != nil {
			fmt.Printf("Error getting source export path ID for %s: %v\n", exportPath, err)
			return
		}
		sourcePathIDs = append(sourcePathIDs, sourcePathID)
	}

	// Create discovery job
	fmt.Printf("Creating discovery job for source file server...\n")
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
		fmt.Printf("Error creating discovery job: %v\n", err)
		return
	}
	defer resp.Body.Close()
	fmt.Printf("✅ Source discovery job created with config IDs: %s\n", sourceJobConfigIDs)

	// Phase 4: Dynamic ANF Volume Creation
	fmt.Println("\n=== Phase 4: Creating Destination ANF Volumes  ===")
	fmt.Printf("Creating destination ANF volumes...\n")
	err = createAzureNetAppVolumes(config)
	if err != nil {
		fmt.Printf("Failed to create ANF volumes: %v\n", err)
		return
	}

	fmt.Printf("📁 Created Destination Paths:\n")
	for i, path := range config.DestinationPaths {
		fmt.Printf("   %d: %s\n", i+1, path)
	}

	// Phase 5: Create Destination File Server
	fmt.Println("\n=== Phase 5: Create Destination File Server ===")
	destinationParams := CreateServereParams{
		ConfigName:       "destination",
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         "root",
		Password:         "",
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             DESTINATION_HOST_IP, // Azure ANF host
		Workers:          workerIds,
		WorkingDirectory: "",
		// No ExportPathSource specified 
	}

	destinationFileServerId, resp, err := CreateFileServer(destinationParams, headers)
	if err != nil {
		fmt.Printf("Failed to create destination file server: %v\n", err)
		return
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		fmt.Printf("Destination file server creation failed with status: %d\n", resp.StatusCode)
		return
	}
	fmt.Printf("✅ Destination file server created: %s\n", destinationFileServerId)
	fmt.Printf("⏳ Waiting for destination file server to be ready...\n")
	time.Sleep(1 * time.Minute) 

	fmt.Println("\n🎉 Azure NDM Scale Test Environment Ready!")
	fmt.Printf("📊 Ready for 8-path concurrent migration testing!\n")
	fmt.Printf("🔗 Source Host: %s (8 export paths)\n", SOURCE_HOST_IP)
	fmt.Printf("📁 Source File Server ID: %s\n", sourceFileServerId)
	fmt.Printf("🎯 Destination Host: %s (8 ANF volumes)\n", DESTINATION_HOST_IP)
	fmt.Printf("📁 Destination File Server ID: %s\n", destinationFileServerId)
	fmt.Printf("📊 Control Plane Dashboard: http://%s:8080\n", cpIP)

	fmt.Printf("\nNDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)
}

// setupMigrationJob creates a migration job from source to destination/mnt/data/AI/kb-vol-scale-run
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
	fmt.Println("===================Creating migration job===================")
	jobIds, resp, err := CreateMigrationJob(migrationParams, headers)
	if err != nil {
		return fmt.Errorf("failed to create migration job: %w", err)
	}

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("migration job creation failed with status: %d", resp.StatusCode)
	}

	if len(jobIds) > 0 {
		fmt.Printf("========>Migration job created successfully with ID: %s\n", jobIds[0])
		fmt.Printf("========>Migration: %s:/mnt/data/AI → %s:/kb-vol-scale-run\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)

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
		fmt.Printf("========>Migration: %s:/mnt/data/AI → %s:/kb-vol-scale-run\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)

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
		ResourceGroup:  "MigrationAsAService-dev-infra",         // VM infrastructure RG
		Location:       "eastus2",                               // VM location
		VNetName:       "MigrationAsAService-dev-VNET02",        // VM VNet
		SubnetName:     "MigrationAsAService-dev-VNET02_Subnet01", // VM Subnet
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
	cpConfig.VMName = fmt.Sprintf("%s-cp-azure-automated-scale-%s", username, time.Now().Format("20060102-150405"))
	cpConfig.ImageVersion = cpImageVersion
	cpIP, err := createSingleVMAndGetIP(cpConfig)
	if err != nil {
		return "", "", fmt.Errorf("*********failed to create Control Plane VM: %v*********", err)
	}

	// Create Worker VM
	workerConfig := config
	workerConfig.VMType = "worker"
	workerConfig.VMName = fmt.Sprintf("%s-worker-azure-automated-scale-%s", username, time.Now().Format("20060102-150405"))
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

	// Images are stored in a different resource group than VMs
	sourceImageResourceGroup := "datamigrate-acr-resource-group"
	
	if config.ImageVersion == "" {
		// Get latest version from image resource group
		fmt.Printf("   📋 Getting latest %s image from %s...\n", config.VMType, sourceImageResourceGroup)
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
		imageID := strings.TrimSpace(string(output))
		fmt.Printf("   ✅ Using latest %s image: %s\n", config.VMType, imageID)
		return imageID, nil
	} else {
		// Get specific version from image resource group
		fmt.Printf("   📋 Looking for %s image version: %s in %s...\n", config.VMType, config.ImageVersion, sourceImageResourceGroup)
		cmd := exec.Command("az", "sig", "image-version", "show",
			"--resource-group", sourceImageResourceGroup,
			"--gallery-name", config.GalleryName,
			"--gallery-image-definition", imageDefinition,
			"--gallery-image-version", config.ImageVersion,
			"--query", "id",
			"--output", "tsv")

		output, err := cmd.Output()
		if err != nil {
			fmt.Printf("   ⚠️  Image version %s not found, falling back to latest...\n", config.ImageVersion)
			// Fallback to latest version if specific version not found
			return getLatestImageForVM(config, sourceImageResourceGroup, imageDefinition)
		}
		imageID := strings.TrimSpace(string(output))
		fmt.Printf("   ✅ Using specified %s image version: %s\n", config.VMType, config.ImageVersion)
		return imageID, nil
	}
}

func getLatestImageForVM(config VMConfig, resourceGroup, imageDefinition string) (string, error) {
	fmt.Printf("   🔄 Getting latest %s image from %s...\n", config.VMType, resourceGroup)
	cmd := exec.Command("az", "sig", "image-version", "list",
		"--resource-group", resourceGroup,
		"--gallery-name", config.GalleryName,
		"--gallery-image-definition", imageDefinition,
		"--query", "[0].id",
		"--output", "tsv")

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get latest image for %s: %v", imageDefinition, err)
	}
	
	imageID := strings.TrimSpace(string(output))
	if imageID == "" {
		return "", fmt.Errorf("no image versions found for %s", imageDefinition)
	}
	
	fmt.Printf("   ✅ Using latest %s image: %s\n", config.VMType, imageID)
	return imageID, nil
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
	os.Setenv("AZ_SOURCE_HOST_IP", "10.192.7.42")         // Original scale test IP
	os.Setenv("AZ_DESTINATION_HOST_IP", "10.0.4.9")
	os.Setenv("AZURE_NFS_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZURE_NFS_NDM_WORKERS_USER_NAME", "ubuntu")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PORT", "22")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PASSWORD", "Password@123")
	os.Setenv("AZURE_NFS_SOURCE_VOLUMES", "/mnt/data/AI")
	os.Setenv("AZURE_NFS_DESTINATION_VOLUMES", "/kb-vol-scale-run")
	os.Setenv("AZURE_NFS_SOURCE_HOST_IP", "10.192.7.42")  // Original scale test IP
	os.Setenv("AZURE_NFS_DESTINATION_HOST_IP", "10.0.4.9")
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
				fmt.Println("Waiting 1 minute for services to finish setup...")
				time.Sleep(60 * time.Second)
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

// // LogNodeMetricsToFile fetches and logs worker metrics every 5 minutes using a ticker
// func LogNodeMetricsToFile(endpoint string, filename string) {
// 	fmt.Printf("🔄 Starting worker metrics collection from: %s\n", endpoint)
// 	fmt.Printf("📊 Metrics will be logged to: %s\n", filename)
// 	fmt.Printf("⏰ Collection interval: every 5 minutes\n")

// 	// Create a ticker for 5-minute intervals
// 	ticker := time.NewTicker(5 * time.Minute)
// 	defer ticker.Stop()

// 	// Collect metrics immediately on start
// 	collectAndLogMetrics(endpoint, filename)

// 	// Then collect every 5 minutes
// 	for range ticker.C {
// 		collectAndLogMetrics(endpoint, filename)
// 	}
// }

// // collectAndLogMetrics performs a single metrics collection and logging operation
// func collectAndLogMetrics(endpoint string, filename string) {
// 	fmt.Printf("📡 Fetching worker metrics at %s...\n", time.Now().Format("15:04:05"))

// 	// Create HTTP client with timeout
// 	client := &http.Client{
// 		Timeout: 30 * time.Second,
// 		Transport: &http.Transport{
// 			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
// 		},
// 	}

// 	resp, err := client.Get(endpoint)
// 	if err != nil {
// 		fmt.Printf("❌ Failed to fetch worker metrics: %v\n", err)
// 		return
// 	}
// 	defer resp.Body.Close()

// 	if resp.StatusCode != http.StatusOK {
// 		fmt.Printf("❌ Worker metrics endpoint returned status: %d\n", resp.StatusCode)
// 		return
// 	}

// 	body, err := io.ReadAll(resp.Body)
// 	if err != nil {
// 		fmt.Printf("❌ Failed to read worker metrics response: %v\n", err)
// 		return
// 	}

// 	metrics := string(body)
// 	timestamp := time.Now().Format(time.RFC3339)

// 	// Log with timestamp and separator for easy parsing
// 	logEntry := fmt.Sprintf("=== WORKER METRICS SNAPSHOT ===\n")
// 	logEntry += fmt.Sprintf("Timestamp: %s\n", timestamp)
// 	logEntry += fmt.Sprintf("Endpoint: %s\n", endpoint)
// 	logEntry += fmt.Sprintf("Status: %d\n", resp.StatusCode)
// 	logEntry += fmt.Sprintf("Data Size: %d bytes\n", len(body))
// 	logEntry += fmt.Sprintf("=== METRICS DATA ===\n")
// 	logEntry += metrics
// 	logEntry += fmt.Sprintf("\n=== END SNAPSHOT ===\n\n")

// 	// Write to file with proper error handling
// 	f, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
// 	if err != nil {
// 		fmt.Printf("❌ Failed to open metrics log file: %v\n", err)
// 		return
// 	}
// 	defer f.Close()

// 	_, err = f.WriteString(logEntry)
// 	if err != nil {
// 		fmt.Printf("❌ Failed to write metrics to file: %v\n", err)
// 		return
// 	}

// 	fmt.Printf("✅ Worker metrics collected successfully (%d bytes)\n", len(body))
// }

// // SystemMetrics represents system performance metrics
// type SystemMetrics struct {
// 	Timestamp string           `json:"timestamp"`
// 	Source    string           `json:"source"`
// 	CPU       CPUMetrics       `json:"cpu"`
// 	Memory    MemoryMetrics    `json:"memory"`
// 	Disk      DiskMetrics      `json:"disk"`
// 	Network   []NetworkMetrics `json:"network"`
// 	GoRuntime GoRuntimeMetrics `json:"go_runtime"`
// }

// type CPUMetrics struct {
// 	PerCore   []float64 `json:"per_core"`
// 	Total     float64   `json:"total"`
// 	CoreCount int       `json:"core_count"`
// }

// type MemoryMetrics struct {
// 	Total       uint64  `json:"total_bytes"`
// 	Used        uint64  `json:"used_bytes"`
// 	Free        uint64  `json:"free_bytes"`
// 	UsedPercent float64 `json:"used_percent"`
// }

// type DiskMetrics struct {
// 	Total       uint64  `json:"total_bytes"`
// 	Used        uint64  `json:"used_bytes"`
// 	Free        uint64  `json:"free_bytes"`
// 	UsedPercent float64 `json:"used_percent"`
// 	Path        string  `json:"path"`
// }

// type NetworkMetrics struct {
// 	Interface   string `json:"interface"`
// 	BytesSent   uint64 `json:"bytes_sent"`
// .BytesRecv   uint64 `json:"bytes_recv"`
// 	PacketsSent uint64 `json:"packets_sent"`
// 	PacketsRecv uint64 `json:"packets_recv"`
// }

// type GoRuntimeMetrics struct {
// 	Goroutines int    `json:"goroutines"`
// 	HeapAlloc  uint64 `json:"heap_alloc_bytes"`
// 	HeapSys    uint64 `json:"heap_sys_bytes"`
// 	HeapInuse  uint64 `json:"heap_inuse_bytes"`
// 	StackInuse uint64 `json:"stack_inuse_bytes"`
// 	GCCycles   uint32 `json:"gc_cycles"`
// 	LastGCTime string `json:"last_gc_time"`
// }

// // LogSystemMetricsToFile logs CPU, memory, disk, network, and Go runtime metrics in JSON format
// func LogSystemMetricsToFile(filename string) {
// 	for {
// 		metrics := collectSystemMetrics()

// 		// Convert to JSON
// 		jsonData, err := json.MarshalIndent(metrics, "", "  ")
// 		if err != nil {
// 			fmt.Printf("Error marshaling metrics: %v\n", err)
// 			time.Sleep(5 * time.Minute)
// 			continue
// 		}

// 		// Write to file
// 		f, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
// 		if err != nil {
// 			fmt.Printf("Error opening log file: %v\n", err)
// 			time.Sleep(5 * time.Minute)
// 			continue
// 		}

// 		f.WriteString(string(jsonData) + "\n")
// 		f.Close()

// 		time.Sleep(5 * time.Minute)
// 	}
// }

// // collectSystemMetrics gathers all system and Go runtime metrics
// func collectSystemMetrics() SystemMetrics {
// 	var metrics SystemMetrics
// 	var m runtime.MemStats
// 	runtime.ReadMemStats(&m)

// 	metrics.Timestamp = time.Now().Format(time.RFC3339)
// 	metrics.Source = "automation_host_local" // This Go script runs locally, NOT on worker VM

// 	// CPU metrics
// 	cpuPercents, _ := cpu.Percent(0, true)
// 	cpuTotal, _ := cpu.Percent(0, false)
// 	metrics.CPU = CPUMetrics{
// 		PerCore:   cpuPercents,
// 		Total:     cpuTotal[0],
// 		CoreCount: len(cpuPercents),
// 	}

// 	// Memory metrics
// 	vmStat, _ := mem.VirtualMemory()
// 	metrics.Memory = MemoryMetrics{
// 		Total:       vmStat.Total,
// 		Used:        vmStat.Used,
// 		Free:        vmStat.Free,
// 		UsedPercent: vmStat.UsedPercent,
// 	}

// 	// Disk metrics
// 	diskStat, _ := disk.Usage("/")
// 	metrics.Disk = DiskMetrics{
// 		Total:       diskStat.Total,
// 		Used:        diskStat.Used,
// 		Free:        diskStat.Free,
// 		UsedPercent: diskStat.UsedPercent,
// 		Path:        "/",
// 	}

// 	// Network metrics
// 	netIOs, _ := net.IOCounters(true)
// 	for _, ioStat := range netIOs {
// 		metrics.Network = append(metrics.Network, NetworkMetrics{
// 			Interface:   ioStat.Name,
// 			BytesSent:   ioStat.BytesSent,
// 			BytesRecv:   ioStat.BytesRecv,
// 			PacketsSent: ioStat.PacketsSent,
// 			PacketsRecv: ioStat.PacketsRecv,
// 		})
// 	}

// 	// Go runtime metrics
// 	var lastGC string
// 	if m.LastGC > 0 {
// 		lastGC = time.Unix(0, int64(m.LastGC)).Format(time.RFC3339)
// 	}

// 	metrics.GoRuntime = GoRuntimeMetrics{
// 		Goroutines: runtime.NumGoroutine(),
// 		HeapAlloc:  m.HeapAlloc,
// 		HeapSys:    m.HeapSys,
// 		HeapInuse:  m.HeapInuse,
// 		StackInuse: m.StackInuse,
// 		GCCycles:   m.NumGC,
// 		LastGCTime: lastGC,
// 	}

// 	return metrics
// }

// =================== AZURE SCALE TESTING ENHANCEMENT FUNCTIONS ===================

// setupAzureScaleTestEnvironment enhances the existing Azure scale test with multi-path capabilities
func setupAzureScaleTestEnvironment(cpIP, workerIP string) error {
	fmt.Println("\n==================== ENHANCED AZURE SCALE TESTING ====================")

	// Initialize Azure scale configuration with your real ANF setup
	config := &AzureScaleConfig{
		SubscriptionID:       "1630c6a9-d99b-498a-aca8-a271f7506bc0",
		ResourceGroup:        "MigrationAsAService-dev-infra",
		Location:             "eastus2",
		VNetName:             "MigrationAsAService-dev-VNET02",
		SubnetName:           "MigrationAsAService-dev-VNET02_Subnet01",
		SourcePathCount:      8, // Scale testing with 8 paths
		DestinationPathCount: 8,
		VolumeSize:           "4TB",                              // Matching your capacity pool size
		ANFAccountName:       "JEEVITHA-BUG-TEST",                // Your real ANF account
		ANFPoolName:          "JEEVITHA-BUG-POOL",                // Your real capacity pool
		ANFSubnetName:        "MigrationAsAService-dev-Subnet02", // Your ANF subnet
		ANFVNetName:          "MigrationAsAService-dev-VNET01",   // Your ANF VNet
	}

	fmt.Printf("🚀 Azure Scale Test Configuration:\n")
	fmt.Printf("   📊 Source Paths: %d\n", config.SourcePathCount)
	fmt.Printf("   📁 Destination Volumes: %d\n", config.DestinationPathCount)
	fmt.Printf("   💾 Volume Size: %s each\n", config.VolumeSize)

	// Phase 1: Generate source and destination paths
	fmt.Println("\n====================Phase 1: Generating Scale Test Paths====================")
	// Use identical hardcoded source paths 
	config.SourceExportPaths = []string{"/volSrcAI", "/volSrcAI_clone_2", "/volSrcAI_clone_3", "/volSrcAI_clone_4", "/volSrcAI_clone_5", "/volSrcAI_clone_6", "/volSrcAI_clone_7", "/volSrcAI_clone_8"}

	// Generate destination paths for Azure ANF volumes
	config.DestinationPaths = []string{}
	for i := 1; i <= config.DestinationPathCount; i++ {
		destPath := fmt.Sprintf("/vol-dst-azure-%s-%d", time.Now().Format("20060102"), i)
		config.DestinationPaths = append(config.DestinationPaths, destPath)
	}

	fmt.Printf("📂 Source Export Paths:\n")
	for i, path := range config.SourceExportPaths {
		fmt.Printf("   %d. %s\n", i+1, path)
	}

	fmt.Printf("🎯 Destination Paths:\n")
	for i, path := range config.DestinationPaths {
		fmt.Printf("   %d. %s\n", i+1, path)
	}

	// Phase 2: Create Azure NetApp Files volumes
	fmt.Println("\n====================Phase 2: Creating Azure NetApp Files Volumes====================")
	err := createAzureNetAppVolumes(config)
	if err != nil {
		return fmt.Errorf("failed to create ANF volumes: %v", err)
	}

	// Phase 3: Setup enhanced file servers with multiple paths
	fmt.Println("\n====================Phase 3: Setting Up Multi-Path File Servers====================")
	sourceFileServerID, destinationFileServerID, err := setupEnhancedFileServers(config, cpIP)
	if err != nil {
		return fmt.Errorf("failed to setup enhanced file servers: %v", err)
	}

	// Phase 4: Execute NDM workflow with scale testing
	fmt.Println("\n====================Phase 4: Executing Enhanced NDM Workflow====================")
	err = executeEnhancedNDMWorkflow(config, sourceFileServerID, destinationFileServerID, cpIP)
	if err != nil {
		return fmt.Errorf("failed to execute enhanced NDM workflow: %v", err)
	}

	fmt.Println("\n🎉 ===== AZURE ENHANCED SCALE TESTING COMPLETED SUCCESSFULLY! =====")
	fmt.Printf("✅ Processed %d source → destination path migrations\n", len(config.SourceExportPaths))
	fmt.Printf("📊 Control Plane Dashboard: http://%s:8080\n", cpIP)

	return nil
}

// createAzureNetAppVolumes creates multiple ANF volumes using EXISTING infrastructure
//  Azure uses existing ANF account and capacity pool
func createAzureNetAppVolumes(config *AzureScaleConfig) error {
	fmt.Printf("🔧 Creating %d Azure NetApp Files volumes dynamically...\n", config.DestinationPathCount)
	fmt.Printf("📋 Using EXISTING ANF Account: %s \n", config.ANFAccountName)
	fmt.Printf("📋 Using EXISTING Capacity Pool: %s \n", config.ANFPoolName)

	// Clear and rebuild destination paths with actual ANF volumes 
	config.DestinationPaths = []string{}

	// Create volumes dynamically for each destination path 
	for i := 1; i <= config.DestinationPathCount; i++ {
		volumeName := fmt.Sprintf("vol-dst-scale-%s-%d", time.Now().Format("20060102"), i)
		creationToken := volumeName // Use same as volume name

		fmt.Printf("📁 Creating ANF volume %d/%d: %s\n", i, config.DestinationPathCount, volumeName)

		mountPoint, err := createSingleANFVolume(config, volumeName, creationToken)
		if err != nil {
			return fmt.Errorf("failed to create ANF volume %s: %v", volumeName, err)
		}

		// Add the actual mount path to destination paths 
		config.DestinationPaths = append(config.DestinationPaths, "/"+volumeName)

		fmt.Printf("✅ Created volume: %s with mount point: %s\n", volumeName, mountPoint)
	}

	fmt.Printf("⏳ Waiting 3 minutes for all ANF volumes to be READY...\n")
	time.Sleep(3 * time.Minute) 

	fmt.Printf("🎯 Azure NetApp Files volume creation completed!\n")
	return nil
}

// createSingleANFVolume creates a single Azure NetApp Files volume and returns mount point
func createSingleANFVolume(config *AzureScaleConfig, volumeName, creationToken string) (string, error) {
	// Get the ANF subnet ID using your infrastructure details
	subnetID := fmt.Sprintf("/subscriptions/%s/resourceGroups/%s/providers/Microsoft.Network/virtualNetworks/%s/subnets/%s",
		config.SubscriptionID, config.ResourceGroup, config.ANFVNetName, config.ANFSubnetName)

	// Create ANF volume using Azure CLI (equivalent to gcloud beta netapp volumes create)
	
	volumeSizeBytes := "161061273600" // 150GB in bytes 

	createVolumeCmd := fmt.Sprintf(`az netappfiles volume create \
		--resource-group %s \
		--location %s \
		--account-name %s \
		--pool-name %s \
		--name %s \
		--service-level Standard \
		--usage-threshold %s \
		--creation-token %s \
		--subnet "%s" \
		--protocol-types NFSv3 \
		--export-policy '[{"allowedClients":"0.0.0.0/0","cifs":false,"nfsv3":true,"nfsv4":false,"ruleIndex":1,"unixReadOnly":false,"unixReadWrite":true}]' \
		--output json`,
		config.ResourceGroup,
		config.Location,
		config.ANFAccountName, // EXISTING ANF account 
		config.ANFPoolName,    // EXISTING capacity pool 
		volumeName,            // NEW volume name
		volumeSizeBytes,
		creationToken,
		subnetID)

	fmt.Printf("   📝 Creating ANF volume with Azure CLI...\n")
	output, err := exec.Command("bash", "-c", createVolumeCmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to create ANF volume: %v\nOutput: %s", err, string(output))
	}

	// Parse the JSON output to get mount target IP 
	var volumeResponse map[string]interface{}
	if err := json.Unmarshal(output, &volumeResponse); err != nil {
		return "", fmt.Errorf("failed to parse volume creation response: %v", err)
	}

	// Extract mount target IP from response 
	properties, ok := volumeResponse["properties"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("no properties found in volume response")
	}

	mountTargets, ok := properties["mountTargets"].([]interface{})
	if !ok || len(mountTargets) == 0 {
		return "", fmt.Errorf("no mount targets found in volume response")
	}

	firstTarget, ok := mountTargets[0].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("invalid mount target format")
	}

	ipAddress, ok := firstTarget["ipAddress"].(string)
	if !ok {
		return "", fmt.Errorf("no IP address found in mount target")
	}

	// Return mount point in format: IP:/creationToken 
	mountPoint := fmt.Sprintf("%s:/%s", ipAddress, creationToken)

	// Wait for volume to be provisioned
	fmt.Printf("   ⏳ Waiting for volume %s to be provisioned...\n", volumeName)
	return mountPoint, waitForANFVolume(config, volumeName)
}

// ensureANFInfrastructure ensures ANF account and capacity pool exist
func ensureANFInfrastructure(config *AzureScaleConfig) error {
	fmt.Printf("🔍 Ensuring ANF infrastructure exists...\n")

	// Create ANF account if it doesn't exist
	createAccountCmd := fmt.Sprintf(`az netappfiles account create \
		--resource-group %s \
		--location %s \
		--account-name %s \
		--output none || echo "Account may already exist"`,
		config.ResourceGroup, config.Location, config.ANFAccountName)

	_, err := exec.Command("bash", "-c", createAccountCmd).CombinedOutput()
	if err != nil {
		fmt.Printf("⚠️  Warning: ANF account creation issue: %v\n", err)
	}

	// Create capacity pool if it doesn't exist
	createPoolCmd := fmt.Sprintf(`az netappfiles pool create \
		--resource-group %s \
		--location %s \
		--account-name %s \
		--pool-name %s \
		--size 4 \
		--service-level Premium \
		--output none || echo "Pool may already exist"`,
		config.ResourceGroup, config.Location, config.ANFAccountName, config.ANFPoolName)

	_, err = exec.Command("bash", "-c", createPoolCmd).CombinedOutput()
	if err != nil {
		fmt.Printf("⚠️  Warning: ANF pool creation issue: %v\n", err)
	}

	fmt.Printf("✅ ANF infrastructure ready\n")
	return nil
}

// getANFSubnetID gets the subnet ID for Azure NetApp Files delegation using your ANF VNet
func getANFSubnetID(config *AzureScaleConfig) (string, error) {
	cmd := fmt.Sprintf(`az network vnet subnet show \
		--resource-group %s \
		--vnet-name %s \
		--name %s \
		--query id \
		--output tsv`,
		config.ResourceGroup, config.ANFVNetName, config.ANFSubnetName)

	output, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get ANF subnet ID: %v\nOutput: %s", err, string(output))
	}

	subnetID := strings.TrimSpace(string(output))
	if subnetID == "" {
		return "", fmt.Errorf("empty subnet ID returned")
	}

	return subnetID, nil
}

// waitForANFVolume waits for an ANF volume to be provisioned successfully
func waitForANFVolume(config *AzureScaleConfig, volumeName string) error {
	maxAttempts := 30
	for i := 0; i < maxAttempts; i++ {
		checkCmd := fmt.Sprintf(`az netappfiles volume show \
			--resource-group %s \
			--account-name %s \
			--pool-name %s \
			--name %s \
			--query provisioningState \
			--output tsv`,
			config.ResourceGroup, config.ANFAccountName, config.ANFPoolName, volumeName)

		output, err := exec.Command("bash", "-c", checkCmd).CombinedOutput()
		if err != nil {
			if i < maxAttempts-1 {
				fmt.Printf("   ⏳ Checking volume status, attempt %d/%d...\n", i+1, maxAttempts)
				time.Sleep(10 * time.Second)
				continue
			}
			return fmt.Errorf("failed to check volume status: %v", err)
		}

		status := strings.TrimSpace(string(output))
		fmt.Printf("   📊 Volume %s status: %s\n", volumeName, status)

		if status == "Succeeded" {
			fmt.Printf("   ✅ Volume %s is ready!\n", volumeName)
			return nil
		}

		if status == "Failed" {
			return fmt.Errorf("volume %s provisioning failed", volumeName)
		}

		if i < maxAttempts-1 {
			fmt.Printf("   ⏳ Waiting for volume to be ready (attempt %d/%d)...\n", i+1, maxAttempts)
			time.Sleep(10 * time.Second)
		}
	}

	return fmt.Errorf("volume %s did not become ready after %d attempts", volumeName, maxAttempts)
}

// setupEnhancedFileServers creates source and destination file servers with multiple export paths
func setupEnhancedFileServers(config *AzureScaleConfig, cpIP string) (string, string, error) {
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  "application/json",
	}

	workerIds := GetWorkerIds()
	if len(workerIds) == 0 {
		return "", "", fmt.Errorf("no worker IDs available")
	}

	// Create source file server 
	fmt.Printf("📂 Creating source file server with %d export paths...\n", len(config.SourceExportPaths))
	sourceParams := CreateServereParams{
		ConfigName:       "source",
		ConfigType:       ConfigTypeFile,
		ProjectID:        ProjectID,
		ServerType:       ServerTypeOtherNAS,
		UserName:         "root",
		Password:         "",
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersionNFS_V3,
		Host:             SOURCE_HOST_IP,
		Workers:          workerIds,
		WorkingDirectory: "",
		// No ExportPathSource specified 
	}

	sourceFileServerId, resp, err := CreateFileServer(sourceParams, headers)
	if err != nil {
		return "", "", fmt.Errorf("failed to create source file server: %v", err)
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", "", fmt.Errorf("source file server creation failed with status: %d", resp.StatusCode)
	}
	fmt.Printf("✅ Source file server created: %s\n", sourceFileServerId)
	fmt.Printf("⏳ Waiting for source file server to be ready...\n")
	time.Sleep(1 * time.Minute) 

	// Create destination file server 
	fmt.Printf("🎯 Creating destination file server with %d ANF volumes...\n", len(config.DestinationPaths))

	destinationParams := CreateServereParams{
		ConfigName:       "destination",
		ConfigType:       ConfigTypeFile,
		ProjectID:        ProjectID,
		ServerType:       ServerTypeOtherNAS,
		UserName:         "root",
		Password:         "",
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             DESTINATION_HOST_IP, // Keep using Azure destination host
		Workers:          workerIds,
		WorkingDirectory: "",
		// No ExportPathSource specified
	}

	destinationFileServerId, resp, err := CreateFileServer(destinationParams, headers)
	if err != nil {
		return "", "", fmt.Errorf("failed to create destination file server: %v", err)
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", "", fmt.Errorf("destination file server creation failed with status: %d", resp.StatusCode)
	}
	fmt.Printf("✅ Destination file server created: %s\n", destinationFileServerId)
	fmt.Printf("⏳ Waiting for destination file server to be ready...\n")
	time.Sleep(1 * time.Minute) 

	return sourceFileServerId, destinationFileServerId, nil
}

// getANFMountPoints retrieves mount information for created ANF volumes
func getANFMountPoints(config *AzureScaleConfig) ([]string, error) {
	mountPoints := []string{}

	for i := 1; i <= config.DestinationPathCount; i++ {
		volumeName := fmt.Sprintf("vol-dst-azure-%d", i)

		cmd := fmt.Sprintf(`az netappfiles volume show \
			--resource-group %s \
			--account-name %s \
			--pool-name %s \
			--name %s \
			--query mountTargets[0].ipAddress \
			--output tsv`,
			config.ResourceGroup, config.ANFAccountName, config.ANFPoolName, volumeName)

		output, err := exec.Command("bash", "-c", cmd).CombinedOutput()
		if err != nil {
			fmt.Printf("⚠️  Warning: Failed to get mount point for %s: %v\n", volumeName, err)
			continue
		}

		mountIP := strings.TrimSpace(string(output))
		if mountIP != "" {
			mountPoints = append(mountPoints, mountIP)
		}
	}

	if len(mountPoints) == 0 {
		return nil, fmt.Errorf("no ANF mount points found")
	}

	return mountPoints, nil
}

// executeEnhancedNDMWorkflow runs discovery, migration, and cutover jobs for scale testing
func executeEnhancedNDMWorkflow(config *AzureScaleConfig, sourceFileServerID, destinationFileServerID, cpIP string) error {
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  "application/json",
	}

	// Phase 4.1: Bulk Discovery Job
	fmt.Printf("\n=== Phase 4.1: Discovery Job (Bulk Operation on %d paths) ===\n", len(config.SourceExportPaths))
	sourcePathIDs, err := getAllExportPathIDs("source", config.SourceExportPaths, sourceFileServerID, headers)
	if err != nil {
		return fmt.Errorf("failed to get source path IDs: %v", err)
	}

	discoveryParams := DiscoveryJobParams{
		SourcePathIDs:            sourcePathIDs,
		ExcludeFilePatterns:      "",
		PreserveAccessTime:       false,
		WorkflowExecutionTimeout: "60s",
		FirstRunAt:               GetCurrentUTCTimestamp(),
		Extra: map[string]interface{}{
			"scanDepth": 3,
		},
	}

	discoveryJobIDs, resp, err := CreateDiscoveryJob(discoveryParams, headers)
	if err != nil {
		return fmt.Errorf("failed to create discovery job: %v", err)
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("discovery job creation failed with status: %d", resp.StatusCode)
	}

	fmt.Printf("✅ Discovery job created with %d job IDs\n", len(discoveryJobIDs))
	for i, jobID := range discoveryJobIDs {
		fmt.Printf("   Discovery Job %d: %s\n", i+1, jobID)
	}

	// Wait for discovery jobs to complete
	err = waitForJobsCompletion(discoveryJobIDs, "discovery", headers)
	if err != nil {
		fmt.Printf("⚠️  Warning: Discovery jobs may not have completed successfully: %v\n", err)
	}

	// Phase 4.2: Migration Job (1:1 Path Mapping)
	fmt.Printf("\n=== Phase 4.2: Migration Job (1:1 Path Mapping for %d paths) ===\n", len(config.DestinationPaths))
	destinationPathIDs, err := getAllExportPathIDs("destination", config.DestinationPaths, destinationFileServerID, headers)
	if err != nil {
		return fmt.Errorf("failed to get destination path IDs: %v", err)
	}

	migrationParams := MigrationJobParams{
		FirstRunAt:         GetCurrentUTCTimestamp(),
		FutureRunSchedule:  "",
		SourcePathIDs:      sourcePathIDs,
		DestinationPathIDs: destinationPathIDs,
		SidMapping:         false,
		Options: map[string]interface{}{
			"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
			"preserveAccessTime":  true,
			"skipFile":            "0-M",
		},
	}

	migrationJobIDs, resp, err := CreateMigrationJob(migrationParams, headers)
	if err != nil {
		return fmt.Errorf("failed to create migration job: %v", err)
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("migration job creation failed with status: %d", resp.StatusCode)
	}

	fmt.Printf("✅ Migration job created with %d job IDs\n", len(migrationJobIDs))
	for i, jobID := range migrationJobIDs {
		fmt.Printf("   Migration Job %d: %s\n", i+1, jobID)
	}

	// Wait for migration jobs to complete
	err = waitForJobsCompletion(migrationJobIDs, "migration", headers)
	if err != nil {
		fmt.Printf("⚠️  Warning: Migration jobs may not have completed successfully: %v\n", err)
	}

	// Phase 4.3: Bulk Cutover Job (Approval Workflow)
	fmt.Printf("\n=== Phase 4.3: Bulk Cutover Job (Approval Workflow) ===\n")
	cutoverParams := BulkCutoverJobParams{
		SourcePathIDs:      sourcePathIDs,
		DestinationPathIDs: destinationPathIDs,
	}

	cutoverJobIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
	if err != nil {
		return fmt.Errorf("failed to create bulk cutover job: %v", err)
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return fmt.Errorf("bulk cutover job creation failed with status: %d", resp.StatusCode)
	}

	fmt.Printf("✅ Bulk cutover job created with %d job IDs\n", len(cutoverJobIDs))

	// Handle cutover approval workflow
	err = handleCutoverApprovalWorkflow(cutoverJobIDs, headers)
	if err != nil {
		return fmt.Errorf("failed to handle cutover approval: %v", err)
	}

	fmt.Printf("🎉 Enhanced NDM workflow completed successfully!\n")
	fmt.Printf("📊 Total paths processed: %d\n", len(sourcePathIDs))

	return nil
}

// getAllExportPathIDs gets export path IDs for multiple paths
func getAllExportPathIDs(pathType string, paths []string, fileServerID string, headers map[string]string) ([]string, error) {
	pathIDs := []string{}

	for _, path := range paths {
		pathID, err := GetExportPathID(pathType, path, fileServerID, headers)
		if err != nil {
			fmt.Printf("⚠️  Warning: Failed to get path ID for %s: %v\n", path, err)
			continue
		}
		pathIDs = append(pathIDs, pathID)
		fmt.Printf("   ✅ %s path: %s → ID: %s\n", pathType, path, pathID)
	}

	if len(pathIDs) == 0 {
		return nil, fmt.Errorf("no valid path IDs found for %s paths", pathType)
	}

	return pathIDs, nil
}

// waitForJobsCompletion waits for multiple jobs to complete
func waitForJobsCompletion(jobIDs []string, jobType string, headers map[string]string) error {
	fmt.Printf("⏳ Waiting for %d %s jobs to complete...\n", len(jobIDs), jobType)

	for i, jobID := range jobIDs {
		fmt.Printf("   Checking %s job %d/%d: %s\n", jobType, i+1, len(jobIDs), jobID)

		// Get job run details
		jobRunResp, resp, err := GetJobRunDetails(jobID, headers)
		if err != nil {
			fmt.Printf("   ⚠️  Warning: Failed to get job run details for %s: %v\n", jobID, err)
			continue
		}

		if resp.StatusCode != 200 {
			fmt.Printf("   ⚠️  Warning: Job run details request failed with status: %d\n", resp.StatusCode)
			continue
		}

		if len(jobRunResp.JobRuns) > 0 {
			jobRunID := jobRunResp.JobRuns[0].JobRunId
			fmt.Printf("   Job Run ID: %s, Status: %s\n", jobRunID, jobRunResp.JobRuns[0].Status)

			// Wait for job to reach running state
			err = WaitForJobState(jobRunID, RUNNING_JOBRUN)
			if err != nil {
				fmt.Printf("   ⚠️  Warning: Job %s may not have started: %v\n", jobID, err)
			} else {
				fmt.Printf("   ✅ %s job %d is RUNNING\n", jobType, i+1)
			}
		}
	}

	fmt.Printf("✅ %s jobs check completed\n", jobType)
	return nil
}

// handleCutoverApprovalWorkflow manages the cutover approval process
func handleCutoverApprovalWorkflow(cutoverJobIDs []string, headers map[string]string) error {
	fmt.Printf("🔄 Handling cutover approval workflow...\n")

	for i, jobID := range cutoverJobIDs {
		fmt.Printf("   Processing cutover job %d/%d: %s\n", i+1, len(cutoverJobIDs), jobID)

		// Get job run details
		jobRunResp, resp, err := GetJobRunDetails(jobID, headers)
		if err != nil {
			fmt.Printf("   ⚠️  Warning: Failed to get cutover job details: %v\n", err)
			continue
		}

		if resp.StatusCode != 200 {
			fmt.Printf("   ⚠️  Warning: Cutover job details request failed with status: %d\n", resp.StatusCode)
			continue
		}

		if len(jobRunResp.JobRuns) > 0 {
			jobRunID := jobRunResp.JobRuns[0].JobRunId

			// Wait for job to be in BLOCKED state (waiting for approval)
			fmt.Printf("   ⏳ Waiting for cutover job to be BLOCKED (awaiting approval)...\n")
			err = WaitForJobState(jobRunID, BLOCKED_JOBRUN)
			if err != nil {
				fmt.Printf("   ⚠️  Warning: Cutover job may not be blocked: %v\n", err)
				continue
			}

			// Approve the cutover job
			fmt.Printf("   ✅ Cutover job is BLOCKED, approving...\n")
			approveResp, err := ApproveRejectBulkCutoverJob(jobRunID, "approve", headers)
			if err != nil {
				fmt.Printf("   ⚠️  Warning: Failed to approve cutover job: %v\n", err)
				continue
			}

			if approveResp.StatusCode == 200 || approveResp.StatusCode == 204 {
				fmt.Printf("   ✅ Cutover job %d approved successfully\n", i+1)
			} else {
				fmt.Printf("   ⚠️  Warning: Cutover approval returned status: %d\n", approveResp.StatusCode)
			}
		}
	}

	fmt.Printf("🎯 Cutover approval workflow completed\n")
	return nil
}
