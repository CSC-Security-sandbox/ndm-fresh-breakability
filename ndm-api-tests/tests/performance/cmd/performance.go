package main

import (
	"fmt"
	"log"
	
	"github.com/joho/godotenv"
	. "ndm-api-tests/tests/performance"
)

func main(){
	fmt.Println("🚀 Starting NDM Performance Test...")
	
	// Load .env file first
	err := godotenv.Load("../.env")
	if err != nil {
		log.Printf("Warning: Error loading .env file: %v", err)
	} else {
		fmt.Println("✅ .env file loaded successfully")
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
	
	fmt.Println("\n🎯 NDM Performance Test Environment is ready for testing!")
	fmt.Println("📊 Ready for data migration performance tests!")
	fmt.Printf("🔗 Source Host: %s\n", SOURCE_HOST_IP)
	fmt.Printf("📁 Source File Server ID: %s\n", sourceFileServerId)
}
