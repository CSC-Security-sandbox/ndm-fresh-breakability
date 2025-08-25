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
	cpIP, workerIP := "172.30.203.30", "172.30.203.31"
	var err error = nil
	// cpIP := "172.30.203.26"
	// workerIP := "172.30.203.27"
	// var err error = nil
	// if err != nil {
	// 	log.Fatalf("Failed to create Azure VMs: %v", err)
	// }
	fmt.Println("Created VM as simulation")

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

	// Create migration job from /mnt/data/AI (source) to /kb-vol-perf-run (destination)
	fmt.Println("\n====================Setting Up Migration Job====================")
	err = setupMigrationJob(sourceFileServerId, destinationFileServerId, "/mnt/data/AI", "/kb-vol-perf-run", headers)
	if err != nil {
		fmt.Printf("⚠️  Warning: Failed to setup migration job: %v\n", err)
	}

	fmt.Println("\n🎯 NDM Performance Test Environment is ready for testing!")
	fmt.Println("📊 Ready for data migration performance tests!")
	fmt.Printf("🔗 Source Host: %s\n", SOURCE_HOST_IP)
	fmt.Printf("📁 Source File Server ID: %s\n", sourceFileServerId)
	if DESTINATION_HOST_IP != "" {
		fmt.Printf("🎯 Destination Host: %s\n", DESTINATION_HOST_IP)
		fmt.Printf("📁 Destination Volume: %s:/kb-vol-perf-run\n", DESTINATION_HOST_IP)
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

// setupMigrationJob creates a migration job from source to destination/mnt/data/AI/kb-vol-perf-run
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
		fmt.Printf("========>Migration: %s:/mnt/data/AI → %s:/kb-vol-perf-run\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)

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
		fmt.Printf("========>Migration: %s:/mnt/data/AI → %s:/kb-vol-perf-run\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)

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
	os.Setenv("AZ_SOURCE_HOST_IP", "10.0.0.169")
	os.Setenv("AZ_DESTINATION_HOST_IP", "10.0.4.9")
	os.Setenv("AZURE_NFS_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZURE_NFS_NDM_WORKERS_USER_NAME", "ubuntu")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PORT", "22")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PASSWORD", "Password@123")
	os.Setenv("AZURE_NFS_SOURCE_VOLUMES", "/mnt/data/AI")
	os.Setenv("AZURE_NFS_DESTINATION_VOLUMES", "/kb-vol-perf-run")
	os.Setenv("AZURE_NFS_SOURCE_HOST_IP", "10.0.0.169")
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
// 	BytesRecv   uint64 `json:"bytes_recv"`
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
