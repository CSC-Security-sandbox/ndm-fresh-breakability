package main

import (
	"fmt"
	"log"
	
	"github.com/joho/godotenv"
	. "ndm-api-tests/tests/performance"
)

func main(){
	fmt.Println("🚀 Starting NDM Performance Test...")
	
	// Load .env file first - try multiple locations
	err := godotenv.Load(".env")  // Try local .env first
	if err != nil {
		err = godotenv.Load("../.env")  // Try parent directory
		if err != nil {
			err = godotenv.Load("../../.env")  // Try tests directory
			if err != nil {
				log.Printf("Warning: Error loading .env file from any location: %v", err)
			} else {
				fmt.Println("✅ .env file loaded from tests directory")
			}
		} else {
			fmt.Println("✅ .env file loaded from parent directory")
		}
	} else {
		fmt.Println("✅ .env file loaded from current directory")
	}
	
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
		
		// Call the CreateFileServer function for destination
		destinationFileServerId, destResp, err := CreateFileServer(destinationParams, headers)
		if err != nil {
			fmt.Printf("❌ Failed to create destination file server: %v\n", err)
		} else if destResp.StatusCode != 200 && destResp.StatusCode != 201 {
			fmt.Printf("❌ Destination file server creation failed with status: %d\n", destResp.StatusCode)
		} else {
			fmt.Printf("✅ Destination file server created with ID: %s\n", destinationFileServerId)
			
			// Create migration job from /mnt/data/AI (source) to /kb-vol-perf-run (destination)
			fmt.Println("\n🚚 Setting up migration job...")
			err = setupMigrationJob(sourceFileServerId, destinationFileServerId, headers)
			if err != nil {
				fmt.Printf("⚠️  Warning: Failed to setup migration job: %v\n", err)
			}
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
			"skipFile":            "0-M",
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
	} else {
		return fmt.Errorf("no job IDs returned from migration job creation")
	}
	
	return nil
}
