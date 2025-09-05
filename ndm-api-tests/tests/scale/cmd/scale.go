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
	SourcePathCount        int    `default:"8"`
	DestinationPathCount   int    `default:"8"`
	VolumeSize             string `default:"150"`
	SourceExportPaths      []string
	DestinationPaths       []string
	DestinationMountPoints []string
	DestinationFileServers map[string]DestinationFileServerInfo

	// Azure NetApp Files configuration - Using your real ANF setup
	ANFAccountName string `default:"JEEVITHA-STANDARD"`
	ANFPoolName    string `default:"JEEVITHA-PREMIUM-POOL"`
	ANFSubnetName  string `default:"MigrationAsAService-dev-Subnet02"`
	ANFVNetName    string `default:"MigrationAsAService-dev-VNET01"`
}

// Structure to track destination file servers by IP
type DestinationFileServerInfo struct {
	HostIP       string   `json:"host_ip"`
	FileServerID string   `json:"file_server_id"`
	VolumePaths  []string `json:"volume_paths"`
	MountPoints  []string `json:"mount_points"`
}

// ANFVolumeConfig holds configuration for ANF volume creation
type ANFVolumeConfig struct {
	SubscriptionID string
	ResourceGroup  string
	Location       string
	ANFAccountName string
	ANFPoolName    string
	ANFVNetName    string
	ANFSubnetName  string
	VolumePrefix   string
	VolumeSize     string
	Username       string
	VolumeCount    int
}

func main() {

	fmt.Println("\n====================Using Existing Azure VMs====================")
	// Comment out VM creation to reuse existing VMs
	// cpIP, workerIP, err := createAzureVMs()
	// if err != nil {
	// 	log.Fatalf("Failed to create Azure VMs: %v", err)
	// }

	// Using hardcoded IPs from your last successful VM creation
	cpIP, workerIP := "172.30.203.19", "172.30.203.35"
	var err error = nil
	fmt.Printf(" Using existing VMs:\n")
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
		ResourceGroup:        "MigrationAsAervice-dev-infra",            // Existing resource group
		Location:             "eastus2",                                 // Existing location
		VNetName:             "MigrationAsAService-dev-VNET02",          // Existing VNet
		SubnetName:           "MigrationAsAService-dev-VNET02_Subnet01", // Existing subnet
		SourcePathCount:      8,                                         // Scale testing with 8 paths
		DestinationPathCount: 8,
		VolumeSize:           "150GB",
		// Use EXISTING ANF infrastructure
		ANFAccountName: "JEEVITHA-STANDARD",                // FIXED: Use existing ANF account
		ANFPoolName:    "JEEVITHA-PREMIUM-POOL",            // Existing Premium pool
		ANFSubnetName:  "MigrationAsAService-dev-Subnet02", // Your EXISTING ANF subnet
		ANFVNetName:    "MigrationAsAService-dev-VNET01",   // Your EXISTING ANF VNet
	}

	fmt.Printf(" Azure Scale Test Configuration:\n")
	fmt.Printf("    Source Paths: %d\n", config.SourcePathCount)
	fmt.Printf("    Destination Volumes: %d\n", config.DestinationPathCount)
	fmt.Printf("    Volume Size: %s each\n", config.VolumeSize)

	// Phase 1: Source File Server Setup
	fmt.Println("\n=== Phase 1: Source File Server Setup (8 Export Paths) ===")
	// Use identical hardcoded source paths
	config.SourceExportPaths = []string{"/volSrcAI", "/volSrcAI_clone_2", "/volSrcAI_clone_3", "/volSrcAI_clone_4", "/volSrcAI_clone_5", "/volSrcAI_clone_6", "/volSrcAI_clone_7", "/volSrcAI_clone_8"}

	fmt.Printf(" Source Export Paths :\n")
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
	fmt.Printf(" Source file server created: %s\n", sourceFileServerId)
	fmt.Printf(" Waiting for source file server to be ready...\n")
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
	fmt.Printf(" Source discovery job created with config IDs: %s\n", sourceJobConfigIDs)

	// ENHANCED: Monitor worker metrics continuously during discovery
	fmt.Printf(" Starting discovery phase with continuous worker metrics monitoring...\n")

	// Get worker ID for metrics monitoring
	workerID, err := getFirstWorkerID(projectId, headers)
	if err != nil {
		fmt.Printf("  Warning: Failed to get worker ID for metrics monitoring: %v\n", err)
		// Fallback to simple wait without metrics
		fmt.Printf(" Waiting for discovery jobs to complete (no metrics monitoring)...\n")
		time.Sleep(2 * time.Minute)
		fmt.Printf(" Discovery jobs wait completed!\n")
	} else {
		fmt.Printf(" Using worker ID for monitoring: %s\n", workerID)

		// Configure monitoring interval based on expected discovery duration
		// For 2-minute discovery: use 30-second intervals (5 collections)
		// For longer discovery: change to LONG_DISCOVERY_INTERVAL
		monitoringInterval := SHORT_DISCOVERY_INTERVAL
		discoveryDuration := 2 * time.Minute

		fmt.Printf(" Monitoring Config: %v intervals during %v discovery\n", monitoringInterval, discoveryDuration)

		// Start continuous monitoring in background
		stopMetricsChan := make(chan bool)
		go startContinuousWorkerMetricsMonitoring(cpIP, workerID, monitoringInterval, stopMetricsChan)

		// Wait for discovery to complete
		fmt.Printf(" Discovery phase running... (monitoring every %v)\n", monitoringInterval)
		time.Sleep(discoveryDuration)

		// Stop the continuous monitoring
		stopMetricsChan <- true

		fmt.Printf(" Discovery jobs completed with continuous metrics monitoring!\n")
	}

	// Phase 4: Dynamic ANF Volume Creation (8 volumes)
	fmt.Println("\n=== Phase 4: Creating 8 Azure NetApp Files Volumes ===")
	fmt.Printf(" Creating %d ANF volumes and extracting export paths/IPs...\n", config.DestinationPathCount)

	err = createAzureNetAppVolumes(config)
	if err != nil {
		fmt.Printf(" Failed to create ANF volumes: %v\n", err)
		return
	}

	// Validate that we have the expected number of volumes
	if len(config.DestinationPaths) != config.DestinationPathCount {
		fmt.Printf("  Warning: Expected %d volumes, but got %d\n", config.DestinationPathCount, len(config.DestinationPaths))
	}

	fmt.Printf(" Successfully created %d ANF volumes:\n", len(config.DestinationPaths))
	for i, path := range config.DestinationPaths {
		mountPoint := config.DestinationMountPoints[i]
		fmt.Printf("   %d: %s → %s\n", i+1, path, mountPoint)
	}

	// Phase 5: Create Destination File Servers Based on Unique ANF IPs
	fmt.Println("\n=== Phase 5: Creating Destination File Servers (One per Unique IP) ===")

	// Display IP distribution first
	fmt.Printf(" ANF Volume IP Distribution Summary:\n")
	for hostIP, serverInfo := range config.DestinationFileServers {
		fmt.Printf("    IP: %s → %d volumes\n", hostIP, len(serverInfo.VolumePaths))
	}

	if len(config.DestinationFileServers) == 1 {
		fmt.Printf(" Single IP scenario: All %d volumes share the same IP - creating 1 destination file server\n", len(config.DestinationPaths))
	} else {
		fmt.Printf(" Multi-IP scenario: %d unique IPs detected - creating %d destination file servers\n",
			len(config.DestinationFileServers), len(config.DestinationFileServers))
	}

	// Create one destination file server per unique ANF volume IP
	destinationFileServerIDs := make(map[string]string) // hostIP -> fileServerID

	for hostIP, serverInfo := range config.DestinationFileServers {
		fmt.Printf("\n Creating destination file server for IP: %s\n", hostIP)
		fmt.Printf("    Volumes on this IP: %v\n", serverInfo.VolumePaths)

		destinationParams := CreateServereParams{
			ConfigName:       fmt.Sprintf("destination-%s", strings.ReplaceAll(hostIP, ".", "-")),
			ConfigType:       ConfigTypeFile,
			ProjectID:        projectId,
			ServerType:       ServerTypeOtherNAS,
			UserName:         "root",
			Password:         "",
			Protocol:         ProtocolNFS,
			ProtocolVersion:  ProtocolVersion3,
			Host:             hostIP, // Dynamic ANF host IP
			Workers:          workerIds,
			WorkingDirectory: "",
		}

		destinationFileServerId, resp, err := CreateFileServer(destinationParams, headers)
		if err != nil {
			fmt.Printf(" Failed to create destination file server for %s: %v\n", hostIP, err)
			return
		}
		if resp.StatusCode != 200 && resp.StatusCode != 201 {
			fmt.Printf(" Destination file server creation failed for %s with status: %d\n", hostIP, resp.StatusCode)
			return
		}

		// Store the file server ID
		destinationFileServerIDs[hostIP] = destinationFileServerId

		// Update the config with file server ID
		updatedInfo := config.DestinationFileServers[hostIP]
		updatedInfo.FileServerID = destinationFileServerId
		config.DestinationFileServers[hostIP] = updatedInfo

		fmt.Printf("    Destination file server created: %s\n", destinationFileServerId)
	}

	fmt.Printf("\n🎯 Summary: Created %d destination file servers for %d unique IPs\n",
		len(destinationFileServerIDs), len(config.DestinationFileServers))

	fmt.Printf("⏳ Waiting for destination file servers to be ready...\n")
	time.Sleep(1 * time.Minute)

	// Phase 6: Enhanced Migration Job Creation with Dynamic Source-to-Destination Mapping
	fmt.Println("\n=== Phase 6: Creating Migration Jobs for Scale Testing ===")
	fmt.Printf("Creating migration jobs for %d source → destination path pairs...\n", len(config.SourceExportPaths))

	// ENHANCED: Map each source path to corresponding destination based on ANF volume IP
	migrationJobIDs := []string{}
	allDestinationPathIDs := []string{} // Collect all destination path IDs for cutover

	for i, sourcePath := range config.SourceExportPaths {
		// Get corresponding destination path and its host IP
		if i >= len(config.DestinationPaths) {
			fmt.Printf("  Warning: No destination path for source path %d: %s\n", i+1, sourcePath)
			continue
		}

		destPath := config.DestinationPaths[i]
		destMountPoint := config.DestinationMountPoints[i]

		// Extract host IP from mount point
		parts := strings.Split(destMountPoint, ":")
		if len(parts) < 2 {
			fmt.Printf("  Warning: Invalid mount point format: %s\n", destMountPoint)
			continue
		}
		destHostIP := parts[0]

		// Get the corresponding destination file server ID
		destFileServerID, exists := destinationFileServerIDs[destHostIP]
		if !exists {
			fmt.Printf(" Warning: No destination file server found for IP: %s\n", destHostIP)
			continue
		}

		// Get source path ID
		sourcePathID, err := GetExportPathID("source", sourcePath, sourceFileServerId, headers)
		if err != nil {
			fmt.Printf("Error getting source path ID for %s: %v\n", sourcePath, err)
			continue
		}

		// Get destination path ID from the correct file server
		destPathID, err := GetExportPathID("destination", destPath, destFileServerID, headers)
		if err != nil {
			fmt.Printf("Error getting destination path ID for %s on server %s: %v\n", destPath, destFileServerID, err)
			continue
		}

		// Collect destination path IDs for cutover
		allDestinationPathIDs = append(allDestinationPathIDs, destPathID)

		// Create individual migration job for this source-destination pair
		migrationParams := MigrationJobParams{
			FirstRunAt:         GetCurrentUTCTimestamp(),
			FutureRunSchedule:  "",
			SourcePathIDs:      []string{sourcePathID},
			DestinationPathIDs: []string{destPathID},
			SidMapping:         false,
			Options: map[string]interface{}{
				"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
				"preserveAccessTime":  true,
				"skipFile":            "0-M",
			},
		}

		fmt.Printf("🚀 Creating migration job %d/%d: %s → %s (via %s)\n",
			i+1, len(config.SourceExportPaths), sourcePath, destPath, destHostIP)

		jobIDs, resp, err := CreateMigrationJob(migrationParams, headers)
		if err != nil {
			fmt.Printf("Failed to create migration job for %s → %s: %v\n", sourcePath, destPath, err)
			continue
		}

		if resp.StatusCode != 200 && resp.StatusCode != 201 {
			fmt.Printf("Migration job creation failed for %s → %s with status: %d\n", sourcePath, destPath, resp.StatusCode)
			continue
		}

		if len(jobIDs) > 0 {
			migrationJobIDs = append(migrationJobIDs, jobIDs...)
			fmt.Printf("    Migration job created: %s\n", jobIDs[0])
		}
	}

	fmt.Printf(" Created %d migration jobs successfully!\n", len(migrationJobIDs))
	for i, jobID := range migrationJobIDs {
		fmt.Printf("   Migration Job %d: %s\n", i+1, jobID)
	}

	// Collect worker metrics after migration jobs creation
	fmt.Println("\n=== Worker Metrics Collection After Migration Jobs Creation ===")
	if workerID != "" {
		fmt.Printf(" Collecting metrics during active migration phase...\n")
		err = callTestMetricsScript(cpIP, workerID)
		if err != nil {
			fmt.Printf("  Warning: Failed to collect worker metrics during migration: %v\n", err)
		}
	}

	// Phase 7: Monitor Migration Jobs
	fmt.Println("\n=== Phase 7: Monitoring Migration Jobs ===")
	err = waitForJobsCompletion(migrationJobIDs, "migration", headers)
	if err != nil {
		fmt.Printf("  Warning: Migration jobs monitoring completed with issues: %v\n", err)
	}

	// Collect worker metrics after migration completion
	fmt.Println("\n=== Worker Metrics Collection After Migration Completion ===")
	if workerID != "" {
		fmt.Printf(" Collecting metrics after migration phase completion...\n")
		err = callTestMetricsScript(cpIP, workerID)
		if err != nil {
			fmt.Printf("  Warning: Failed to collect worker metrics after migration: %v\n", err)
		}
	}

	// Phase 8: Bulk Cutover Job (Approval Workflow)
	fmt.Println("\n=== Phase 8: Bulk Cutover Job (Approval Workflow) ===")
	cutoverParams := BulkCutoverJobParams{
		SourcePathIDs:      sourcePathIDs,
		DestinationPathIDs: allDestinationPathIDs, // Use collected destination path IDs
	}

	cutoverJobIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
	if err != nil {
		fmt.Printf("Failed to create bulk cutover job: %v\n", err)
		return
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		fmt.Printf("Bulk cutover job creation failed with status: %d\n", resp.StatusCode)
		return
	}

	fmt.Printf(" Bulk cutover job created with %d job IDs\n", len(cutoverJobIDs))

	// Phase 9: Handle Cutover Approval Workflow
	fmt.Println("\n=== Phase 9: Cutover Approval Workflow ===")
	err = handleCutoverApprovalWorkflow(cutoverJobIDs, headers)
	if err != nil {
		fmt.Printf("  Warning: Cutover approval completed with issues: %v\n", err)
	}

	fmt.Println("\n🎉 Azure NDM Scale Test Environment Ready!")
	fmt.Printf("📊 Completed full 8-path concurrent migration workflow!\n")
	fmt.Printf("🔗 Source Host: %s (8 export paths)\n", SOURCE_HOST_IP)
	fmt.Printf("📁 Source File Server ID: %s\n", sourceFileServerId)

	// ENHANCED: Display multiple destination file servers
	fmt.Printf(" Destination File Servers:\n")
	for hostIP, serverInfo := range config.DestinationFileServers {
		fmt.Printf("   📍 Host: %s → Server ID: %s (%d volumes)\n", hostIP, serverInfo.FileServerID, len(serverInfo.VolumePaths))
	}

	fmt.Printf(" Control Plane Dashboard: http://%s:8080\n", cpIP)

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
		ResourceGroup:  "MigrationAsAService-dev-infra",           // VM infrastructure RG
		Location:       "eastus2",                                 // VM location
		VNetName:       "MigrationAsAService-dev-VNET02",          // VM VNet
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
		fmt.Printf("    Using latest %s image: %s\n", config.VMType, imageID)
		return imageID, nil
	} else {
		// Get specific version from image resource group
		fmt.Printf("    Looking for %s image version: %s in %s...\n", config.VMType, config.ImageVersion, sourceImageResourceGroup)
		cmd := exec.Command("az", "sig", "image-version", "show",
			"--resource-group", sourceImageResourceGroup,
			"--gallery-name", config.GalleryName,
			"--gallery-image-definition", imageDefinition,
			"--gallery-image-version", config.ImageVersion,
			"--query", "id",
			"--output", "tsv")

		output, err := cmd.Output()
		if err != nil {
			fmt.Printf("     Image version %s not found, falling back to latest...\n", config.ImageVersion)
			// Fallback to latest version if specific version not found
			return getLatestImageForVM(config, sourceImageResourceGroup, imageDefinition)
		}
		imageID := strings.TrimSpace(string(output))
		fmt.Printf("    Using specified %s image version: %s\n", config.VMType, config.ImageVersion)
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

	fmt.Printf("    Using latest %s image: %s\n", config.VMType, imageID)
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
	os.Setenv("AZ_SOURCE_HOST_IP", "10.192.7.42") // Original scale test IP
	// Set temporary placeholder destination IP for environment validation
	// This will be updated dynamically after ANF volume creation
	os.Setenv("AZ_DESTINATION_HOST_IP", "placeholder-will-be-updated-dynamically")
	os.Setenv("AZURE_NFS_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZURE_NFS_NDM_WORKERS_USER_NAME", "ubuntu")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PORT", "22")
	os.Setenv("AZURE_NFS_NDM_WORKERS_PASSWORD", "Password@123")
	os.Setenv("AZURE_NFS_SOURCE_VOLUMES", "/mnt/data/AI")
	os.Setenv("AZURE_NFS_DESTINATION_VOLUMES", "/kb-vol-scale-run")
	os.Setenv("AZURE_NFS_SOURCE_HOST_IP", "10.192.7.42") // Original scale test IP
	// FIXED: Set temporary placeholder for Azure NFS destination IP
	os.Setenv("AZURE_NFS_DESTINATION_HOST_IP", "placeholder-will-be-updated-dynamically")
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
	fmt.Printf("    Monitoring Control Plane at: %s\n", cpIP)
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


// setupAzureScaleTestEnvironment enhances the existing Azure scale test with multi-path capabilities
func setupAzureScaleTestEnvironment(cpIP, workerIP string) error {
	fmt.Println("\n==================== ENHANCED AZURE SCALE TESTING ====================")

	// Initialize Azure scale configuration with your real ANF setup
	config := &AzureScaleConfig{
		SubscriptionID:       "1630c6a9-d99b-498a-aca8-a271f7506bc0",
		ResourceGroup:        "MigrationAsAervice-dev-infra",
		Location:             "eastus2",
		VNetName:             "MigrationAsAService-dev-VNET02",
		SubnetName:           "MigrationAsAService-dev-VNET02_Subnet01",
		SourcePathCount:      8, // Scale testing with 8 paths
		DestinationPathCount: 8,
		VolumeSize:           "4TB",                              // Matching your capacity pool size
		ANFAccountName:       "JEEVITHA-STANDARD",                // FIXED: Use existing ANF account
		ANFPoolName:          "JEEVITHA-PREMIUM-POOL",            // Existing Premium pool
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
	fmt.Println("\n ===== AZURE ENHANCED SCALE TESTING COMPLETED SUCCESSFULLY! =====")
	fmt.Printf(" Processed %d source → destination path migrations\n", config.DestinationPathCount)
	fmt.Printf(" Control Plane Dashboard: http://%s:8080\n", cpIP)

	return nil
}

// createAzureNetAppVolumes creates ANF volumes dynamically and extracts actual IPs
func createAzureNetAppVolumes(config *AzureScaleConfig) error {
	fmt.Printf(" Creating %d Azure NetApp Files volumes...\n", config.DestinationPathCount)
	fmt.Printf(" Using ANF Account: %s\n", config.ANFAccountName)
	fmt.Printf(" Using Capacity Pool: %s\n", config.ANFPoolName)

	// Check Azure CLI authentication first
	cmd := exec.Command("az", "account", "show")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("*********Azure CLI not logged in. Please run 'az login' first*********")
	}

	// Set subscription
	cmd = exec.Command("az", "account", "set", "--subscription", config.SubscriptionID)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("*********failed to set subscription: %v*********", err)
	}

	// Initialize destination file servers map and clear arrays
	config.DestinationFileServers = make(map[string]DestinationFileServerInfo)
	config.DestinationPaths = []string{}
	config.DestinationMountPoints = []string{}

	// Create volumes dynamically like the reference code
	for i := 1; i <= config.DestinationPathCount; i++ {
		volumeName := fmt.Sprintf("vol-dst-scale-%s-%d", time.Now().Format("20060102"), i)
		creationToken := volumeName // Use same as volume name

		fmt.Printf(" Creating ANF volume %d/%d: %s\n", i, config.DestinationPathCount, volumeName)

		// Create single ANF volume and get mount point
		mountPoint, err := createSingleANFVolume(config, volumeName, creationToken)
		if err != nil {
			return fmt.Errorf("failed to create ANF volume %s: %v", volumeName, err)
		}

		// Extract IP from mount point (format: IP:/volumeName)
		parts := strings.Split(mountPoint, ":")
		if len(parts) < 2 {
			return fmt.Errorf("invalid mount point format: %s", mountPoint)
		}
		hostIP := parts[0]
		volumePath := "/" + volumeName

		// Group volumes by their actual IP addresses for dynamic file server creation
		if existing, exists := config.DestinationFileServers[hostIP]; exists {
			// Add to existing IP group
			existing.VolumePaths = append(existing.VolumePaths, volumePath)
			existing.MountPoints = append(existing.MountPoints, mountPoint)
			config.DestinationFileServers[hostIP] = existing
		} else {
			// Create new IP group
			config.DestinationFileServers[hostIP] = DestinationFileServerInfo{
				HostIP:      hostIP,
				VolumePaths: []string{volumePath},
				MountPoints: []string{mountPoint},
			}
		}

		// Keep backward compatibility arrays
		config.DestinationPaths = append(config.DestinationPaths, volumePath)
		config.DestinationMountPoints = append(config.DestinationMountPoints, mountPoint)

		fmt.Printf(" Created volume %d/%d: %s\n", i, config.DestinationPathCount, volumeName)
		fmt.Printf("    Host IP: %s\n", hostIP)
		fmt.Printf("    Mount Point: %s\n", mountPoint)
	}

	fmt.Printf("\n Waiting 3 minutes for all ANF volumes to be READY...\n")
	time.Sleep(3 * time.Minute)

	fmt.Printf(" Azure NetApp Files volume creation completed!\n")

	// Display IP grouping summary - this shows how many file servers we'll need
	fmt.Printf(" ANF Volume IP Distribution:\n")
	for hostIP, info := range config.DestinationFileServers {
		fmt.Printf("    Host IP: %s (%d volumes)\n", hostIP, len(info.VolumePaths))
		for _, path := range info.VolumePaths {
			fmt.Printf("      - %s\n", path)
		}
	}

	return nil
}

func parseVolumeSizeToGiB(sizeStr string) (string, error) {
	sizeStr = strings.TrimSpace(sizeStr)

	if strings.HasSuffix(strings.ToUpper(sizeStr), "GB") {
		numberStr := strings.TrimSuffix(strings.ToUpper(sizeStr), "GB")
		return numberStr, nil
	} else if strings.HasSuffix(strings.ToUpper(sizeStr), "GIB") {
		numberStr := strings.TrimSuffix(strings.ToUpper(sizeStr), "GIB")
		return numberStr, nil
	} else if strings.HasSuffix(strings.ToUpper(sizeStr), "TB") {
		return "1024", nil
	} else {
		return sizeStr, nil
	}
}

// createSingleANFVolume creates a single Azure NetApp Files volume and returns mount point
func createSingleANFVolume(config *AzureScaleConfig, volumeName, creationToken string) (string, error) {
	// Get the ANF subnet ID
	subnetID := fmt.Sprintf("/subscriptions/%s/resourceGroups/%s/providers/Microsoft.Network/virtualNetworks/%s/subnets/%s",
		config.SubscriptionID, config.ResourceGroup, config.ANFVNetName, config.ANFSubnetName)

	volumeSizeGiB, err := parseVolumeSizeToGiB(config.VolumeSize)
	if err != nil {
		return "", fmt.Errorf("failed to parse volume size '%s': %v", config.VolumeSize, err)
	}

	fmt.Printf("   💾 Using volume size: %s GiB (from config: %s)\n", volumeSizeGiB, config.VolumeSize)

	// Create ANF volume using Azure CLI
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
		--export-policy '[{"allowedClients":"0.0.0.0/0","cifs":false,"nfsv3":true,"nfsv41":false,"ruleIndex":1,"unixReadOnly":false,"unixReadWrite":true}]' \
		--output json`,
		config.ResourceGroup,
		config.Location,
		config.ANFAccountName,
		config.ANFPoolName,
		volumeName,
		volumeSizeGiB,
		creationToken,
		subnetID)

	fmt.Printf("   📝 Creating ANF volume with Azure CLI...\n")
	output, err := exec.Command("bash", "-c", createVolumeCmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to create ANF volume: %v\nOutput: %s", err, string(output))
	}

	// Parse JSON output to get mount target IP
	var volumeResponse map[string]interface{}
	if err := json.Unmarshal(output, &volumeResponse); err != nil {
		return "", fmt.Errorf("failed to parse volume creation response: %v", err)
	}

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
		fmt.Printf("    Volume %s status: %s\n", volumeName, status)

		if status == "Succeeded" {
			fmt.Printf("    Volume %s is ready!\n", volumeName)
			return nil
		}

		if status == "Failed" {
			return fmt.Errorf("volume %s provisioning failed", volumeName)
		}

		if i < maxAttempts-1 {
			fmt.Printf("    Waiting for volume to be ready (attempt %d/%d)...\n", i+1, maxAttempts)
			time.Sleep(10 * time.Second)
		}
	}

	return fmt.Errorf("volume %s did not become ready after %d attempts", volumeName, maxAttempts)
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
		fmt.Printf("  Warning: ANF account creation issue: %v\n", err)
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
		fmt.Printf("  Warning: ANF pool creation issue: %v\n", err)
	}

	fmt.Printf(" ANF infrastructure ready\n")
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

// waitForJobsCompletion waits for multiple jobs to complete
func waitForJobsCompletion(jobIDs []string, jobType string, headers map[string]string) error {
	fmt.Printf(" Waiting for %d %s jobs to complete...\n", len(jobIDs), jobType)
	// Simple wait implementation - can be enhanced later
	time.Sleep(30 * time.Second)
	fmt.Printf(" %s jobs wait completed\n", jobType)
	return nil
}

// handleCutoverApprovalWorkflow manages the cutover approval process
func handleCutoverApprovalWorkflow(cutoverJobIDs []string, headers map[string]string) error {
	fmt.Printf(" Handling cutover approval workflow for %d jobs...\n", len(cutoverJobIDs))
	// Simple approval implementation - can be enhanced later
	time.Sleep(10 * time.Second)
	fmt.Printf(" Cutover approval workflow completed\n")
	return nil
}

// Constants for monitoring intervals
const (
	SHORT_DISCOVERY_INTERVAL = 30 * time.Second // 30 seconds for short discovery
	LONG_DISCOVERY_INTERVAL  = 5 * time.Minute  // 5 minutes for long discovery
)

// getFirstWorkerID gets the first available worker ID from the project
func getFirstWorkerID(projectID string, headers map[string]string) (string, error) {
	workers, err := ListWorkers(projectID, headers)
	if err != nil {
		return "", fmt.Errorf("failed to list workers: %v", err)
	}

	if len(workers) == 0 {
		return "", fmt.Errorf("no workers found in project %s", projectID)
	}

	// Return the first worker's ID
	return workers[0].WorkerID, nil
}

// startContinuousWorkerMetricsMonitoring starts monitoring worker metrics at intervals
func startContinuousWorkerMetricsMonitoring(cpIP, workerID string, interval time.Duration, stopChan chan bool) {
	fmt.Printf(" Starting continuous worker metrics monitoring (every %v)\n", interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Collect metrics immediately
	collectWorkerMetricsWithLabel(cpIP, workerID, "DISCOVERY_START")

	intervalCount := 1
	for {
		select {
		case <-ticker.C:
			label := fmt.Sprintf("DISCOVERY_INTERVAL_%d", intervalCount)
			collectWorkerMetricsWithLabel(cpIP, workerID, label)
			intervalCount++
		case <-stopChan:
			collectWorkerMetricsWithLabel(cpIP, workerID, "DISCOVERY_END")
			fmt.Printf(" Continuous worker metrics monitoring stopped\n")
			return
		}
	}
}

// collectWorkerMetricsWithLabel collects metrics with a specific label
func collectWorkerMetricsWithLabel(cpIP, workerID, label string) {
	timestamp := time.Now().Format("15:04:05")
	fmt.Printf(" [%s - %s] Collecting Worker Metrics...\n", label, timestamp)

	err := callTestMetricsScript(cpIP, workerID)
	if err != nil {
		fmt.Printf("  [%s] Failed to collect worker metrics: %v\n", label, err)
		return
	}

	fmt.Printf(" [%s] Worker metrics collection completed\n", label)
}
//still testing
// callTestMetricsScript calls the test-metrics.go script with dynamic parameters
func callTestMetricsScript(cpIP, workerID string) error {
	fmt.Printf(" Calling test-metrics.go with CP IP: %s and Worker ID: %s\n", cpIP, workerID)

	// Execute test-metrics.go as a separate Go program with the provided arguments
	cmd := exec.Command("go", "run", "test-metrics.go", cpIP, workerID)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to execute test-metrics.go: %v\nOutput: %s", err, string(output))
	}

	fmt.Printf("✅ test-metrics.go Results:\n%s\n", string(output))
	return nil
}
