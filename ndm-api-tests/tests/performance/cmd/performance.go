// (function definition will be placed after imports, not here)
package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	. "ndm-api-tests/utils"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

// callTestMetricsScript executes test-metrics.go with cpIP and workerID
func main() {
	// Setup logging to file with timestamp, and also print to console
	fmt.Println("\n====================Creating a Log file====================")
	logFileName := fmt.Sprintf("perf-log-%s.txt", time.Now().Format("20060102-150405"))
	logFile, err := os.OpenFile(logFileName, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		log.Fatalf("Failed to open log file: %v", err)
	}
	defer logFile.Close()

	mw := io.MultiWriter(os.Stdout, logFile)
	log.SetOutput(mw)
	// For all exec.Command calls, set cmd.Stdout/cmd.Stderr = mw
	// Load configuration from config.json
	config, err := loadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}
	fmt.Printf("Created a ")

	fmt.Println("\n====================Creating Azure VMs====================")
	cpIP, workerIP, err := createAzureVMsWithTerraform(config)
	// cpIP, workerIP := "172.30.203.12", "172.30.203.17"
	// var err error = nil
	if err != nil {
		log.Fatalf("Failed to create Azure VMs: %v", err)
	}

	fmt.Println("\n====================Clearing and Creating Azure NetApp Files Volume====================")
	destinationIP, exportPath, err := createAzureANFVolumeWithTerraform(config)
	if err != nil {
		log.Fatalf("Failed to create Azure ANF volume: %v", err)
	}

	fmt.Println("\n====================Updating Environment Variables=====================")
	err = updateEnvVariables(cpIP, workerIP, destinationIP, exportPath, config)
	if err != nil {
		log.Printf("Failed to update environment variables: %v", err)
	}
	fmt.Println("\nEnvironment Variables after loading:")
	fmt.Printf("===>CP: %s\n", NDM_VM_HOST)
	fmt.Printf("===>Workers: %s\n", NDM_WORKERS_HOST)

	fmt.Println("\n====================Waiting for Control Plane to be UP====================")
	err = waitForControlPlaneReadyWithIP(cpIP, config)
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

	fmt.Println("\n====================Setting up Source File Server====================")
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  config.HTTP.ContentType,
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
		UserName:         NDM_VM_USER_NAME,
		Password:         NDM_VM_PASSWORD,
		Protocol:         ProtocolNFS,
		ProtocolVersion:  ProtocolVersion3,
		Host:             SOURCE_HOST_IP,
		Workers:          workerIds,
		WorkingDirectory: config.Fileserver.WorkingDirectory,
		ExportPathSource: nil,
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
	log.Printf("\n====================Creating Discovery Job on Source====================")
	sourceExportPath := config.Fileserver.SourceExportPath // Use the same path as migration source
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

	fmt.Println("\n====================Setting up Destination File Server====================")
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
		WorkingDirectory: config.Fileserver.WorkingDirectory,
		ExportPathSource: nil, // Will use AutoDiscover default
	}
	destinationFileServerId, _, err := CreateFileServer(destinationParams, headers)
	if err != nil {
		fmt.Printf("Failed to create destination file server: %v\n", err)
		return
	}
	fmt.Printf("======>Destination file Server ID: %s\n", destinationFileServerId)

	fmt.Printf("CP IP : %s\n", cpIP)
	fmt.Printf("Worker IP : %s\n", workerIP)
	fmt.Printf("NDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)

	// Create migration job from config source path to dynamic export path (destination)
	fmt.Println("\n====================Setting Up Migration Job====================")
	jobRunID, sourcePathID, destinationPathID, err := setupMigrationJob(sourceFileServerId, destinationFileServerId, config.Fileserver.SourceExportPath, exportPath, headers, config, cpIP)
	if err != nil {
		fmt.Printf("Warning: Failed to setup migration job: %v\n", err)
	}

	// Monitor migration job progress and handle metrics collection
	fmt.Println("\n====================Migration Job Monitoring====================")
	err = MigrationPolling(jobRunID, cpIP)
	if err != nil {
		fmt.Printf("Warning: Migration polling encountered issues: %v\n", err)
	}

	fmt.Println("\n====================Setting up Cutover Job====================")
	err = setupAndExecuteCutoverJob(sourcePathID, destinationPathID, headers, cpIP)
	if err != nil {
		fmt.Printf("Warning: Cutover job setup and execution failed: %v\n", err)

	}
	fmt.Printf("CP IP : %s\n", cpIP)
	fmt.Printf("Worker IP : %s\n", workerIP)
	fmt.Printf("NDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)
	fmt.Printf("Migration completion details: %s→%s\n", SOURCE_HOST_IP, DESTINATION_HOST_IP)
}

// collectWorkerMetricsWithLabel collects metrics with a specific label
func collectWorkerMetricsWithLabel(cpIP, workerID, label string) error {
	timestamp := time.Now().Format("15:04:05")
	fmt.Printf(" [%s - %s] Collecting Worker Metrics...\n", label, timestamp)

	_, err := LogWorkerMetrics(cpIP, workerID, label)
	if err != nil {
		fmt.Printf("  [%s] Failed to collect worker metrics: %v\n", label, err)
		return err
	}

	fmt.Printf(" [%s] Worker metrics collection completed\n", label)
	return nil
}

// MigrationPolling monitors migration job states and handles metrics collection
func MigrationPolling(jobRunID, cpIP string) error {
	fmt.Printf("Job Run ID: %s\n", jobRunID)
	fmt.Println("Waiting for migration job to start...")

	// Get worker ID for metrics collection
	workerIds := GetWorkerIds()
	var workerID string
	var stopMetricsChan chan bool

	if len(workerIds) == 0 {
		fmt.Printf("Warning: No worker IDs available for migration metrics\n")
		fmt.Printf(" Proceeding with migration monitoring without worker metrics...\n")
	} else {
		workerID = workerIds[0] // Use first available worker ID
		fmt.Printf(" Starting migration metrics collection with Worker ID: %s\n", workerID)
	}

	// Wait for job to reach RUNNING state
	err := WaitForJobState(jobRunID, RUNNING_JOBRUN)
	if err != nil {
		fmt.Printf("Warning: Job may not have started yet: %v\n", err)
	} else {
		fmt.Printf("=============Migration job is now RUNNING=============\n")

		// Collect metrics at START of migration
		if workerID != "" {
			fmt.Printf(" [MIGRATION_START] Collecting worker metrics...\n")
			err = collectWorkerMetricsWithLabel(cpIP, workerID, "MIGRATION_START")
			if err != nil {
				fmt.Printf("Warning: Failed to collect start migration metrics: %v\n", err)
			}

			// Start 5-minute interval metrics collection in background
			fmt.Printf(" Starting 5-minute interval metrics collection during migration...\n")
			stopMetricsChan = make(chan bool, 1)
			go func() {
				ticker := time.NewTicker(5 * time.Minute)
				defer ticker.Stop()
				intervalCount := 1

				for {
					select {
					case <-ticker.C:
						fmt.Printf("[MIGRATION_INTERVAL_%d] Collecting worker metrics...\n", intervalCount)
						err := collectWorkerMetricsWithLabel(cpIP, workerID, fmt.Sprintf("MIGRATION_INTERVAL_%d", intervalCount))
						if err != nil {
							fmt.Printf("Warning: Failed to collect interval %d migration metrics: %v\n", intervalCount, err)
						}
						intervalCount++
					case <-stopMetricsChan:
						fmt.Printf(" Stopping interval metrics collection\n")
						return
					}
				}
			}()
		}
	}

	// Wait for job run to complete with extended timeout (2000 retries = ~2.8 hours)
	fmt.Println("Waiting for migration job to complete...")
	err = WaitForJobState(jobRunID, COMPLETED_JOBRUN, 2000)
	if err != nil {
		fmt.Printf("Warning: Job did not complete successfully: %v\n", err)
	} else {
		fmt.Printf("=============Migration job COMPLETED=============\n")

		// Stop metrics collection after migration is COMPLETED and collect final metrics
		if workerID != "" {
			if stopMetricsChan != nil {
				stopMetricsChan <- true
			}
			fmt.Printf(" [MIGRATION_END] Collecting final worker metrics after migration completion...\n")
			err = collectWorkerMetricsWithLabel(cpIP, workerID, "MIGRATION_END")
			if err != nil {
				fmt.Printf("Warning: Failed to collect end migration metrics: %v\n", err)
			}
		}
	}

	return nil
}

// setupAndExecuteCutoverJob creates, waits for approval, and executes cutover jobs
func setupAndExecuteCutoverJob(sourcePathID, destinationPathID string, headers map[string]string, cpIP string) error {
	// Create cutover job using the same source and destination path IDs from migration
	fmt.Println("Creating bulk cutover job...")
	cutoverParams := BulkCutoverJobParams{
		SourcePathIDs:      []string{sourcePathID},
		DestinationPathIDs: []string{destinationPathID},
	}

	jobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
	if err != nil {
		return fmt.Errorf("error creating bulk cutover job: %w", err)
	}
	defer resp.Body.Close()
	fmt.Printf("======>Cutover job created with config IDs: %v\n", jobConfigIDs)

	// Get job run details for each cutover job and collect run IDs
	var cutoverRunIDs []string
	fmt.Println("Getting cutover job run details...")
	for _, jobConfigID := range jobConfigIDs {
		getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
		if err != nil {
			fmt.Printf("Error getting cutover job run details for config %s: %v\n", jobConfigID, err)
			continue
		}
		defer resp.Body.Close()

		if len(getJobsResp.JobRuns) > 0 {
			cutoverRunID := getJobsResp.JobRuns[0].JobRunId
			fmt.Printf("   Cutover Run ID: %s (Config: %s)\n", cutoverRunID, jobConfigID)

			// Wait for cutover job to reach BLOCKED state (requires approval)
			fmt.Printf("   Waiting for cutover job %s to reach BLOCKED state...\n", cutoverRunID)
			err = WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)
			if err != nil {
				fmt.Printf("   Warning: Cutover job %s did not reach BLOCKED state: %v\n", cutoverRunID, err)
				continue
			}

			// Verify job status after waiting
			getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
			if err != nil {
				fmt.Printf("   Error re-fetching job status for %s: %v\n", jobConfigID, err)
				continue
			}
			defer resp.Body.Close()

			if len(getJobsResp.JobRuns) > 0 && getJobsResp.JobRuns[0].Status == "BLOCKED" {
				fmt.Printf("   ✓ Cutover job %s is now BLOCKED and ready for approval\n", cutoverRunID)
				cutoverRunIDs = append(cutoverRunIDs, cutoverRunID)
			} else {
				fmt.Printf("   Warning: Cutover job %s status is %s (expected BLOCKED)\n", cutoverRunID, getJobsResp.JobRuns[0].Status)
			}
		}
	}

	// Approve all cutover jobs
	fmt.Println("Approving bulk cutover jobs...")
	for _, cutoverRunID := range cutoverRunIDs {
		fmt.Printf("   Approving cutover job: %s\n", cutoverRunID)
		resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
		if err != nil {
			fmt.Printf("   Error approving cutover job %s: %v\n", cutoverRunID, err)
			continue
		}
		defer resp.Body.Close()
		fmt.Printf("   ✓ Cutover job %s approved successfully\n", cutoverRunID)

		// Wait for cutover job to complete
		fmt.Printf("   Waiting for cutover job %s to complete...\n", cutoverRunID)
		err = WaitForJobState(cutoverRunID, COMPLETED_JOBRUN)
		if err != nil {
			fmt.Printf("   Warning: Cutover job %s completion check failed: %v\n", cutoverRunID, err)
		} else {
			fmt.Printf("   ✓ Cutover job %s completed successfully\n", cutoverRunID)
		}
	}

	fmt.Printf("======>Cutover process completed!\n")
	fmt.Printf("CP IP : %s\n", cpIP)
	fmt.Printf("NDM Username: %s\n", USERNAME)
	fmt.Printf("NDM Password: %s\n", PASSWORD)

	return nil
}

type Config struct {
	NDM struct {
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"ndm"`
	VM struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Port     string `json:"port"`
	} `json:"vm"`
	Worker struct {
		Count    string `json:"count"`
		Username string `json:"username"`
		Password string `json:"password"`
		Port     string `json:"port"`
	} `json:"worker"`
	Azure struct {
		SourceHostIP string `json:"source_host_ip"`
		NFS          struct {
			ProtocolUsername string `json:"protocol_username"`
			ProtocolPassword string `json:"protocol_password"`
			SourceVolumes    string `json:"source_volumes"`
		} `json:"nfs"`
	} `json:"azure"`
	Fileserver struct {
		WorkingDirectory string `json:"working_directory"`
		SourceExportPath string `json:"source_export_path"`
	} `json:"fileserver"`
	Migration struct {
		Options struct {
			ExcludeFilePatterns string `json:"exclude_file_patterns"`
			PreserveAccessTime  bool   `json:"preserve_access_time"`
			SkipFile            string `json:"skip_file"`
		} `json:"options"`
	} `json:"migration"`
	HTTP struct {
		ContentType string `json:"content_type"`
	} `json:"http"`
	Timeout struct {
		HTTPClientSeconds   int `json:"http_client_seconds"`
		PingMaxAttempts     int `json:"ping_max_attempts"`
		UIMaxAttempts       int `json:"ui_max_attempts"`
		PingIntervalSeconds int `json:"ping_interval_seconds"`
		UIIntervalSeconds   int `json:"ui_interval_seconds"`
		FinalWaitMinutes    int `json:"final_wait_minutes"`
	} `json:"timeout"`
	VMConfig struct {
		UsernamePrefix     string `json:"username_prefix"`
		CPImageVersion     string `json:"cp_image_version"`
		WorkerImageVersion string `json:"worker_image_version"`
	} `json:"vm_config"`
	ANFConfig struct {
		UsernamePrefix string `json:"anf_username_prefix"`
		DateSuffix     string `json:"anf_date_suffix"`
		SequenceNumber string `json:"anf_sequence_number"`
	} `json:"anf_config"`
}

// loadConfig loads configuration from config.json file
func loadConfig() (*Config, error) {
	file, err := os.Open("config.json")
	if err != nil {
		return nil, fmt.Errorf("failed to open config.json: %v", err)
	}
	defer file.Close()

	var config Config
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&config)
	if err != nil {
		return nil, fmt.Errorf("failed to decode config.json: %v", err)
	}

	return &config, nil
}

// setupMigrationJob creates a migration job from source to destination path
func setupMigrationJob(sourceFileServerId, destinationFileServerId, srcpath, destpath string, headers map[string]string, config *Config, cpIP string) (string, string, string, error) {
	// Get source path ID for source export path
	sourcePathId, err := GetExportPathID("source", srcpath, sourceFileServerId, headers)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get source path ID: %w", err)
	}
	destinationPathId, err := GetExportPathID("destination", destpath, destinationFileServerId, headers)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get destination path ID: %w", err)
	}
	migrationParams := MigrationJobParams{
		FirstRunAt:         GetCurrentUTCTimestamp(),
		FutureRunSchedule:  "",
		SourcePathIDs:      []string{sourcePathId},
		DestinationPathIDs: []string{destinationPathId},
		SidMapping:         false,
		Options: map[string]interface{}{
			"excludeFilePatterns": config.Migration.Options.ExcludeFilePatterns,
			"preserveAccessTime":  config.Migration.Options.PreserveAccessTime,
			"skipFile":            config.Migration.Options.SkipFile,
		},
	}
	fmt.Println("=====>Triggering migration job")
	jobIds, resp, err := CreateMigrationJob(migrationParams, headers)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to create migration job: %w", err)
	}

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", "", "", fmt.Errorf("migration job creation failed with status: %d", resp.StatusCode)
	}

	if len(jobIds) > 0 {
		fmt.Printf("========>Migration job created successfully with ID: %s\n", jobIds[0])
		fmt.Printf("========>Migration: %s:%s → %s:%s\n", SOURCE_HOST_IP, srcpath, DESTINATION_HOST_IP, destpath)

		fmt.Println("   Getting job run details...")
		getJobsResp, resp, err := GetJobRunDetails(jobIds[0], headers)
		if err != nil {
			return "", "", "", fmt.Errorf("failed to get job run details: %w", err)
		}

		if resp.StatusCode != 200 {
			return "", "", "", fmt.Errorf("failed to get job run details, status: %d", resp.StatusCode)
		}

		if len(getJobsResp.JobRuns) > 0 {
			fmt.Printf("Job Status: %s\n", getJobsResp.JobRuns[0].Status)
			return getJobsResp.JobRuns[0].JobRunId, sourcePathId, destinationPathId, nil
		}
	} else {
		return "", "", "", fmt.Errorf("no job IDs returned from migration job creation")
	}

	return "", "", "", nil
}

func createAzureVMsWithTerraform(config *Config) (string, string, error) {
	// Check if Azure CLI is logged in
	cmd := exec.Command("az", "account", "show")
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("*********Azure CLI not logged in. Please run 'az login' first*********")
	}

	// Use config values instead of user input
	// Prompt for values, use config as default if input is empty
	var username, cpImageVersion, workerImageVersion string
	fmt.Printf(">>>>>>>>>Enter username prefix for VM naming [%s]: ", config.VMConfig.UsernamePrefix)
	fmt.Scanln(&username)
	if username == "" {
		username = config.VMConfig.UsernamePrefix
	}
	fmt.Printf(">>>>>>>>>Enter control-plane image version (e.g., 2025.19.08190213) or press Enter for latest [%s]: ", config.VMConfig.CPImageVersion)
	fmt.Scanln(&cpImageVersion)
	if cpImageVersion == "" {
		cpImageVersion = config.VMConfig.CPImageVersion
	}
	fmt.Printf(">>>>>>>>>Enter worker image version (e.g., 2025.19.08185924) or press Enter for latest [%s]: ", config.VMConfig.WorkerImageVersion)
	fmt.Scanln(&workerImageVersion)
	if workerImageVersion == "" {
		workerImageVersion = config.VMConfig.WorkerImageVersion
	}

	args := []string{"./create_vms.sh", "-u", username}
	if cpImageVersion != "" {
		args = append(args, "-c", cpImageVersion)
	}
	if workerImageVersion != "" {
		args = append(args, "-w", workerImageVersion)
	}

	// Execute the shell script
	fmt.Println("Executing Terraform VM creation script...")
	cmd = exec.Command(args[0], args[1:]...)
	mw := log.Writer() // log.Writer() is set to io.MultiWriter(os.Stdout, logFile)
	cmd.Stdout = mw
	cmd.Stderr = mw

	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("*********Failed to execute create_vms.sh script: %v*********", err)
	}

	// Read the VM IPs from the output file
	ipFile := "vm_ips.txt"
	content, err := os.ReadFile(ipFile)
	if err != nil {
		return "", "", fmt.Errorf("*********Failed to read VM IPs from %s: %v*********", ipFile, err)
	}

	// Parse the IP addresses from the file
	var cpIP, workerIP string
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "CP_IP=") {
			cpIP = strings.TrimPrefix(line, "CP_IP=")
		} else if strings.HasPrefix(line, "WORKER_IP=") {
			workerIP = strings.TrimPrefix(line, "WORKER_IP=")
		}
	}

	if cpIP == "" || workerIP == "" {
		return "", "", fmt.Errorf("*********Failed to parse VM IPs from %s. CP_IP: %s, WORKER_IP: %s*********", ipFile, cpIP, workerIP)
	}

	fmt.Println("=======>Both VMs created successfully with Terraform!")
	fmt.Printf("Control Plane IP: %s\n", cpIP)
	fmt.Printf("Worker IP: %s\n", workerIP)

	// Clean up the temporary IP file
	os.Remove(ipFile)

	return cpIP, workerIP, nil
}

func createAzureANFVolumeWithTerraform(config *Config) (string, string, error) {
	// Check if Azure CLI is logged in
	cmd := exec.Command("az", "account", "show")
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("*********Azure CLI not logged in. Please run 'az login' first*********")
	}

	fmt.Println("=======>Starting ANF volume cleanup and creation process...")
	fmt.Println("=======>This will delete ALL existing volumes in KB-NFS-PERF-AUTO/KB-NFS-PERF-AUTO-CP")
	fmt.Println("=======>and create a new one with 1TB size")

	// Use config values instead of user input
	// Prompt for values, use config as default if input is empty
	var username string
	username = config.ANFConfig.UsernamePrefix
	if username == "" {
		username = "perfuser"
	}
	dateInput := config.ANFConfig.DateSuffix         // Default value for date suffix
	sequenceInput := config.ANFConfig.SequenceNumber // Default value for sequence number

	args := []string{"./create_anf_volume.sh", "-u", username}

	if dateInput != "" {
		args = append(args, "-t", dateInput)
	}
	if sequenceInput != "" {
		args = append(args, "-n", sequenceInput)
	}

	// Execute the ANF shell script
	fmt.Println("Executing Terraform ANF volume creation script...")
	fmt.Println("Creating 1TB volume with naming convention: vol-dst-perf-YYYYMMDD-N")
	cmd = exec.Command(args[0], args[1:]...)
	mw := log.Writer()
	cmd.Stdout = mw
	cmd.Stderr = mw

	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("*********Failed to execute create_anf_volume.sh script: %v*********", err)
	}

	// Read the ANF volume info from the output file
	infoFile := "anf_volume_info.txt"
	content, err := os.ReadFile(infoFile)
	if err != nil {
		return "", "", fmt.Errorf("*********Failed to read ANF volume info from %s: %v*********", infoFile, err)
	}

	// Parse the volume information from the file
	var destinationIP, exportPath string
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "DESTINATION_HOST_IP=") {
			destinationIP = strings.TrimPrefix(line, "DESTINATION_HOST_IP=")
		} else if strings.HasPrefix(line, "EXPORT_PATH=") {
			exportPath = strings.TrimPrefix(line, "EXPORT_PATH=")
		}
	}

	if destinationIP == "" || exportPath == "" {
		return "", "", fmt.Errorf("*********Failed to parse ANF volume info from %s. IP: %s, Path: %s*********", infoFile, destinationIP, exportPath)
	}

	fmt.Println("=======>ANF Volume created successfully with Terraform!")
	fmt.Printf("Volume Name: Dynamic (vol-dst-perf-YYYYMMDD-N format, 1TB)\n")
	fmt.Printf("Destination IP: %s\n", destinationIP)
	fmt.Printf("Export Path: %s\n", exportPath)

	// Clean up the temporary info file
	os.Remove(infoFile)

	return destinationIP, exportPath, nil
}

func updateEnvVariables(cpIP, workerIP, destinationIP, exportPath string, config *Config) error {

	// Set all required environment variables using config values
	os.Setenv("JOB_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("CONFIG_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("ADMIN_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("REPORT_SERVICE_URL", fmt.Sprintf("https://%s", cpIP))
	os.Setenv("KEYCLOAK_IP", cpIP)
	os.Setenv("NDM_USERNAME", config.NDM.Username)
	os.Setenv("PASSWORD", config.NDM.Password)
	os.Setenv("NDM_VM_USER_NAME", config.VM.Username)
	os.Setenv("NDM_VM_HOST", cpIP)
	os.Setenv("NDM_VM_PORT", config.VM.Port)
	os.Setenv("NDM_VM_PASSWORD", config.VM.Password)
	os.Setenv("AZ_NDM_VM_HOST", cpIP)
	os.Setenv("AZ_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZ_NDM_WORKER_COUNT", config.Worker.Count)
	os.Setenv("AZ_NDM_WORKERS_USER_NAME", config.Worker.Username)
	os.Setenv("AZ_NDM_WORKERS_PORT", config.Worker.Port)
	os.Setenv("AZ_NDM_WORKERS_PASSWORD", config.Worker.Password)
	os.Setenv("AZ_SOURCE_HOST_IP", config.Azure.SourceHostIP)
	os.Setenv("AZ_DESTINATION_HOST_IP", destinationIP)
	os.Setenv("AZURE_NFS_NDM_WORKERS_HOST", workerIP)
	os.Setenv("AZURE_NFS_NDM_WORKERS_USER_NAME", config.Azure.NFS.ProtocolUsername)
	os.Setenv("AZURE_NFS_NDM_WORKERS_PORT", config.Worker.Port)
	os.Setenv("AZURE_NFS_NDM_WORKERS_PASSWORD", config.Azure.NFS.ProtocolPassword)
	os.Setenv("AZURE_NFS_SOURCE_VOLUMES", config.Azure.NFS.SourceVolumes)
	os.Setenv("AZURE_NFS_DESTINATION_VOLUMES", exportPath)
	os.Setenv("AZURE_NFS_SOURCE_HOST_IP", config.Azure.SourceHostIP)
	os.Setenv("AZURE_NFS_DESTINATION_HOST_IP", destinationIP)
	os.Setenv("AZURE_NFS_PROTOCOL_USERNAME", config.Azure.NFS.ProtocolUsername)
	os.Setenv("AZURE_NFS_PROTOCOL_PASSWORD", config.Azure.NFS.ProtocolPassword)

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

func waitForControlPlaneReadyWithIP(cpIP string, config *Config) error {
	fmt.Printf("==========>Monitoring Control Plane at: %s\n", cpIP)
	startTime := time.Now()
	fmt.Printf("====>Starting monitoring at: %s\n", startTime.Format("15:04:05"))

	// Phase 1: Wait for VM to be pingable (5 minutes max)
	fmt.Println("====>Waiting for VM to be pingable")
	var firstPingTime time.Time
	maxPingAttempts := config.Timeout.PingMaxAttempts // 5 minutes with 5-second intervals

	for i := 0; i < maxPingAttempts; i++ {
		cmd := exec.Command("ping", "-c", "1", cpIP)
		mw := log.Writer()
		cmd.Stdout = mw
		cmd.Stderr = mw
		if cmd.Run() == nil {
			firstPingTime = time.Now()
			pingDuration := firstPingTime.Sub(startTime)
			fmt.Printf("VM is now pingable! (Duration: %v)\n", pingDuration)
			fmt.Printf("First ping successful at: %s\n", firstPingTime.Format("15:04:05"))
			break
		}

		if i == maxPingAttempts-1 {
			return fmt.Errorf("VM not pingable after 5 minutes")
		}

		time.Sleep(time.Duration(config.Timeout.PingIntervalSeconds) * time.Second)
		fmt.Print(".")
	}

	// Phase 2: Wait for NDM UI to be ready (up to 60 minutes)
	fmt.Println("===>Waiting for Control Plane UI to be fully ready...")
	fmt.Println("===>This can take up to 60 minutes for first-time boot...")

	url := fmt.Sprintf("https://%s", cpIP)
	client := &http.Client{
		Timeout: time.Duration(config.Timeout.HTTPClientSeconds) * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	maxUIAttempts := config.Timeout.UIMaxAttempts // 60 minutes with 5-second intervals
	attemptsPerMinute := 12

	for i := 0; i < maxUIAttempts; i++ {
		currentTime := time.Now()
		totalElapsed := currentTime.Sub(startTime)
		sincePing := currentTime.Sub(firstPingTime)

		resp, err := client.Get(url)
		if err == nil {
			defer resp.Body.Close()

			if resp.StatusCode == 200 {
				fmt.Printf("Control Plane UI is fully ready! (Total: %v, Since ping: %v)\n", totalElapsed, sincePing)
				fmt.Printf("UI ready at: %s\n", currentTime.Format("15:04:05"))
				fmt.Printf("Waiting %d minutes for services to finish setup...\n", config.Timeout.FinalWaitMinutes)
				time.Sleep(time.Duration(config.Timeout.FinalWaitMinutes) * time.Minute)
				fmt.Printf("Control Plane is fully operational!\n")
				return nil
			}

			// Handle expected startup statuses - log every 5 minutes
			if (resp.StatusCode == 404 || resp.StatusCode == 503) && i%(attemptsPerMinute*5) == 0 {
				currentMinute := i/attemptsPerMinute + 1
				fmt.Printf("Status: %d (services starting... %d/60 minutes, elapsed: %v)\n",
					resp.StatusCode, currentMinute, totalElapsed)
			} else if resp.StatusCode != 404 && resp.StatusCode != 503 {
				fmt.Printf("Unexpected status: %d (Total elapsed: %v)\n", resp.StatusCode, totalElapsed)
			}
		} else {
			// Log connection errors every 10 minutes
			if i%(attemptsPerMinute*10) == 0 {
				currentMinute := i/attemptsPerMinute + 1
				fmt.Printf("Connection attempt %d/60 (elapsed: %v, waiting for services...)\n",
					currentMinute, totalElapsed)
			}
		}

		time.Sleep(time.Duration(config.Timeout.UIIntervalSeconds) * time.Second)

		// Milestone messages at key intervals
		switch i {
		case attemptsPerMinute * 5: // 5 minutes
			if i > 0 {
				fmt.Printf("5 minutes elapsed (%v) - NDM services are starting up\n", totalElapsed)
			}
		case attemptsPerMinute * 15: // 15 minutes
			fmt.Printf("15 minutes elapsed (%v) - NDM boot process typically takes 20-45 minutes\n", totalElapsed)
		case attemptsPerMinute * 30: // 30 minutes
			fmt.Printf("30 minutes elapsed (%v) - This is normal for first-time boot, continuing...\n", totalElapsed)
		case attemptsPerMinute * 45: // 45 minutes
			fmt.Printf("45 minutes elapsed (%v) - Extended boot time, but still within normal range\n", totalElapsed)
		}
	}

	finalElapsed := time.Since(startTime)
	return fmt.Errorf("control plane UI did not become ready within 60 minutes (total elapsed: %v)", finalElapsed)
}
