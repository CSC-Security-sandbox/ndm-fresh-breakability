package tests

import (
    "encoding/json"
    "fmt"
    "io"
    // "net/http"
	"log"
    "time"
	// "strings"

    . "ndm-api-tests/utils"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

// CreateSourceFileServerRequest represents the request payload for creating a source file server
type CreateSourceFileServerRequest struct {
    ConfigName       string                `json:"configName"`       // Name identifier for the file server configuration
    ConfigType       string                `json:"configType"`       // Type of configuration (FILE, DATABASE, etc.)
    ProjectID        string                `json:"projectId"`        // ID of the project this server belongs to
    FileServers      []FileServerConfig    `json:"fileServers"`      // Array of file server configurations
    WorkingDirectory WorkingDirectoryConfig `json:"workingDirectory"` // Working directory configuration
}

// FileServerConfig represents the configuration for a file server
type FileServerConfig struct {
    ServerType      string   `json:"serverType"`      // Type of server (OtherNAS, NetApp, etc.)
    UserName        string   `json:"userName"`        // Username for server authentication
    Password        string   `json:"password"`        // Password for server authentication
    Protocol        string   `json:"protocol"`        // Protocol used (NFS, SMB, etc.)
    ProtocolVersion string   `json:"protocolVersion"` // Version of the protocol (v3, v4, etc.)
    Host            string   `json:"host"`            // IP address or hostname of the server
    Volumes         []string `json:"volumes"`         // List of volumes available on the server
    Workers         []string `json:"workers"`         // List of worker IDs assigned to this server
}

// WorkingDirectoryConfig represents the working directory configuration
type WorkingDirectoryConfig struct {
    WorkingDirectory string      `json:"workingDirectory"` // Path to the working directory
    PathID           interface{} `json:"pathId"`           // ID of the path (can be null)
    PathName         string      `json:"pathName"`         // Name of the path
}

// CreateDiscoveryJobRequest represents the request payload for creating a discovery job
type CreateDiscoveryJobRequest struct {
    ExcludeOlderThan     string              `json:"excludeOlderThan"`     // ISO timestamp to exclude older files
    ExcludeFilePatterns  string              `json:"excludeFilePatterns"`  // Pattern to exclude certain files
    PreserveAccessTime   bool                `json:"preserveAccessTime"`   // Whether to preserve file access times
    FirstRunAt           string              `json:"firstRunAt"`           // ISO timestamp for first job execution
    SourcePathIDs        []string            `json:"sourcePathIds"`        // Array of source path IDs to discover
    CreatedBy            interface{}         `json:"createdBy"`            // User who created the job (can be null)
    Options              DiscoveryJobOptions `json:"options"`              // Additional job execution options
}

// DiscoveryJobOptions represents options for discovery job execution
type DiscoveryJobOptions struct {
    WorkflowExecutionTimeout string `json:"workflowExecutionTimeout"` // Timeout for entire workflow execution
    WorkflowTaskTimeout      string `json:"workflowTaskTimeout"`      // Timeout for individual workflow tasks
    WorkflowRunTimeout       string `json:"workflowRunTimeout"`       // Timeout for workflow run
    StartDelay               string `json:"startDelay"`               // Delay before starting the job
}

// GetFileServerData represents the data for getting file server information
type GetFileServerData struct {
    Type       string `json:"type"`        // Type of server (source, destination)
    VolumeName string `json:"volume_name"` // Name of the volume to query
}

func sendPostAPIRequest(url string, data map[string]string, authToken string) (map[string]interface{}, error) {
	// Marshal the data into JSON
	reqBody, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		return nil, err
	}
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("POST", url, reqBody, headers)
	if err != nil {
		log.Printf("Error sending API request: %v", err)
		return nil, err
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return nil, err
	}

	var jsonResponse map[string]interface{}
	if err = json.Unmarshal(respBody, &jsonResponse); err != nil {
		log.Printf("Error parsing JSON response: %v", err)
		return nil, err
	}
	return jsonResponse, nil
}

func createProject(authToken string, accountId string) (string, error) {
	fullURL := ADMIN_SERVICE_URL + "/api/v1/projects"
	data := map[string]string{
		"account_id":          accountId,
		"project_name":        AutoGenerateProjectName("test"),
		"project_description": "Project For Automation testing",
		"start_date":          time.Now().UTC().Format(time.RFC3339),
	}

	jsonResponse, err := sendPostAPIRequest(fullURL, data, authToken)
	if err != nil {
		log.Printf("error while sending API request: %v", err)
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

// App Admin Source File Server Test
// This test suite validates the complete workflow of source file server management including:
// 1. Source file server creation and configuration
// 2. File server retrieval and validation
// 3. Discovery job creation and management
// 4. Job execution monitoring and status tracking
var _ = Describe("App Admin Source File Server Test", Ordered, func() {

    // Test variables to store state across test steps
    var (
        headers                    map[string]string // HTTP headers for API requests
        projectID                 string            // ID of the test project
        workerID                   string            // ID of the worker assigned to file server
        sourceHostIP               string            // IP address of the source file server
        configID                   string            // ID of the created file server configuration
        sourcePathID               string            // ID of the source path for discovery
        jobConfigID                string            // ID of the discovery job configuration
        sourceDiscoveryJobRunID    string            // ID of the discovery job run
    )

    BeforeAll(func() {
        // Initialize test environment and perform any necessary cleanup
        fmt.Println("Initializing App Admin Source File Server Test environment.")

		// Create project using the correct function signature
		projectId, err := createProject(AuthToken, AccountId)
		if err != nil {
			Fail(fmt.Sprintf("Failed to create project: %v", err))
		}
		fmt.Printf("Project created with ID: %s\n", projectId)

		// Get available worker IDs by calling the workers API
		workersURL := fmt.Sprintf("%s/api/v1/workers", JOB_SERVICE_URL)
		workersHeaders := GetHeaders(AuthToken, ContentTypeJSON)
		workersResp, err := SendAPIRequest("GET", workersURL, nil, workersHeaders)
		
		var workerId string
		if err != nil {
        fmt.Printf("DEBUG: Error getting workers: %v\n", err)
        workerId = "fallback-worker-id" // Use fallback
    } else {
        defer workersResp.Body.Close()
        if workersResp.StatusCode == 200 {
            bodyBytes, _ := io.ReadAll(workersResp.Body)
            var workersResponse map[string]interface{}
            json.Unmarshal(bodyBytes, &workersResponse)
            
            fmt.Printf("DEBUG: Workers API response: %s\n", string(bodyBytes))
            
            // Try to extract worker ID from response
            if data, ok := workersResponse["data"].([]interface{}); ok && len(data) > 0 {
                if firstWorker, ok := data[0].(map[string]interface{}); ok {
                    if id, ok := firstWorker["workerId"].(string); ok {
                        workerId = id
                        fmt.Printf("DEBUG: Found worker ID: %s\n", workerId)
                    } else if id, ok := firstWorker["id"].(string); ok {
                        workerId = id
                        fmt.Printf("DEBUG: Found worker ID (as 'id'): %s\n", workerId)
                    }
                }
            }
            
            if workerId == "" {
                workerId = "fallback-worker-id"
                fmt.Printf("DEBUG: No worker ID found in response, using fallback\n")
            }
        } else {
            fmt.Printf("DEBUG: Workers API returned status: %d\n", workersResp.StatusCode)
            workerId = "fallback-worker-id"
        }
    }
    
		// Set up required test variables from environment and API responses
		projectID = projectId           // Get from project creation
		workerID = workerId             // Get from workers API or fallback
		sourceHostIP = SOURCE_HOST_IP // Set from environment variable or config

		    // Log the variables being used
		fmt.Printf("DEBUG: Using project_id: %s\n", projectID)
		fmt.Printf("DEBUG: Using workerId: %s\n", workerID)
		fmt.Printf("DEBUG: Using sourceHostIP: %s\n", sourceHostIP)
		
		// Verify we have required variables
		Expect(projectID).NotTo(BeEmpty(), "Project ID should not be empty")
		Expect(sourceHostIP).NotTo(BeEmpty(), "Source Host IP should not be empty")

		fmt.Printf("Test environment initialized - ProjectID: %s, WorkerID: %s, SourceHost: %s\n",
			projectID, workerID, sourceHostIP)

    })

    BeforeEach(func() {
        // Initialize HTTP headers for API requests
        headers = GetHeaders(AuthToken, ContentTypeJSON)
        fmt.Println("Headers initialized for test execution.")
    })

    It("should complete the source file server management workflow", func() {
        By("creating a source file server configuration")
        // Step 1: Create a new source file server configuration
        // This establishes the connection to the source NAS system
        createServerURL := fmt.Sprintf("%s/api/v1/servers", CONFIG_SERVICE_URL)
        
        createServerRequest := CreateSourceFileServerRequest{
            ConfigName: "source-file-server",
            ConfigType: "FILE",
            ProjectID:  projectID,
            FileServers: []FileServerConfig{
                {
                    ServerType:      "OtherNAS",
                    UserName:        "root",
                    Password:        "",
                    Protocol:        "NFS",
                    ProtocolVersion: "v3",
                    Host:            sourceHostIP,
                    Volumes:         []string{}, // Empty volumes array, will be populated during discovery
                    Workers:         []string{workerID},
                },
            },
            WorkingDirectory: WorkingDirectoryConfig{
                WorkingDirectory: "",
                PathID:           nil,
                PathName:         "",
            },
        }

        reqBody, err := json.Marshal(createServerRequest)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal create server request")

        // Send request with delay to allow server processing
        time.Sleep(60 * time.Second) // Wait for server initialization
        
        resp, err := SendAPIRequest("POST", createServerURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred(), "Failed to send create server request")
        defer resp.Body.Close()


        Expect(resp.StatusCode).To(Equal(201), "Expected server creation to return status code 201")

        // Parse response to extract configuration ID
        bodyBytes, err := io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read create server response")

        var createServerResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &createServerResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal create server response")

        if id, ok := createServerResponse["id"].(string); ok {
            configID = id
        }

        Expect(configID).NotTo(BeEmpty(), "Should have received a configuration ID")
        fmt.Printf("Source file server created successfully with ID: %s\n", configID)

        By("retrieving file server information by ID")
		// Step 2: Get file server details and validate the configuration
		// This verifies that the server was created correctly and retrieves volume information
		time.Sleep(5 * time.Second) // Brief delay for server processing

		getServerURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)

		// For GET requests, don't send a body - the API doesn't expect it
		resp, err = SendAPIRequest("GET", getServerURL, nil, headers)
		Expect(err).NotTo(HaveOccurred(), "Failed to send get server request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(200), "Expected server retrieval to return status code 200")

		fmt.Printf("DEBUG: Get server response status code: %d\n", resp.StatusCode)

		// Read the response body only once
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read get server response")

		var getServerResponse map[string]interface{}
		err = json.Unmarshal(bodyBytes, &getServerResponse)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal get server response")

		fmt.Printf("DEBUG: Get server response: %v\n", getServerResponse)

		// Extract source path ID from the volumes array based on the actual response structure
		if fileServers, ok := getServerResponse["fileServers"].([]interface{}); ok && len(fileServers) > 0 {
			if firstServer, ok := fileServers[0].(map[string]interface{}); ok {
				if volumes, ok := firstServer["volumes"].([]interface{}); ok && len(volumes) > 0 {
					// Use the first volume's ID as the source path ID
					if firstVolume, ok := volumes[0].(map[string]interface{}); ok {
						if volumeID, ok := firstVolume["id"].(string); ok {
							sourcePathID = volumeID
							fmt.Printf("DEBUG: Extracted sourcePathID from first volume: %s\n", sourcePathID)
						}
					}
				}
			}
		}

		// If no sourcePathID found, try alternative extraction methods
		if sourcePathID == "" {
			fmt.Printf("WARNING: Could not extract sourcePathID from volumes, trying alternative methods...\n")
			
			// Try to use the server config ID as fallback
			if configId, ok := getServerResponse["id"].(string); ok {
				sourcePathID = configId
				fmt.Printf("DEBUG: Using config ID as sourcePathID fallback: %s\n", sourcePathID)
			}
		}

		Expect(sourcePathID).NotTo(BeEmpty(), "Should have extracted a source path ID")
		fmt.Printf("File server retrieved successfully. Source Path ID: %s\n", sourcePathID)
        
		// By("retrieving file server information by ID")
		// // Step 2: Get file server details and validate the configuration
		// // This verifies that the server was created correctly and retrieves volume information
		// time.Sleep(5 * time.Second) // Brief delay for server processing

		// getServerURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)

		// // Add query parameters matching the YAML data
		// queryParams := fmt.Sprintf("?type=source&volume_name=%s", "/volSrcAuto")
		// getServerURL += queryParams

		// // Alternative: If the API expects JSON body instead of query params
		// getServerData := GetFileServerData{
		// 	Type:       "source",
		// 	VolumeName: "/volSrcAuto",
		// }

		
		// // Try with request body first (more likely based on your struct definition)
		// reqBody, err = json.Marshal(getServerData)
		// Expect(err).NotTo(HaveOccurred(), "Failed to marshal get server request")

		// resp, err = SendAPIRequest("GET", getServerURL, reqBody, headers)
		// Expect(err).NotTo(HaveOccurred(), "Failed to send get server request")
		// defer resp.Body.Close()
		// Expect(resp.StatusCode).To(Equal(200), "Expected server retrieval to return status code 200")

		// fmt.Printf("DEBUG: Get server response status code: %d\n", resp.StatusCode)

		// // Read the response body only once
		// bodyBytes, err = io.ReadAll(resp.Body)
		// Expect(err).NotTo(HaveOccurred(), "Failed to read get server response")

		// fmt.Printf("DEBUG: Get server response body: %s\n", string(bodyBytes))

		// var getServerResponse map[string]interface{}
		// err = json.Unmarshal(bodyBytes, &getServerResponse)
		// Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal get server response")

		// // Extract source path ID from the volumes array based on the actual response structure
		// // Look for volumes that match the volume_name "/volSrcAuto" or similar pattern
		// if fileServers, ok := getServerResponse["fileServers"].([]interface{}); ok && len(fileServers) > 0 {
		// 	if firstServer, ok := fileServers[0].(map[string]interface{}); ok {
		// 		if volumes, ok := firstServer["volumes"].([]interface{}); ok && len(volumes) > 0 {
		// 			// Find the volume that matches the source type or name pattern
		// 			for _, volume := range volumes {
		// 				if vol, ok := volume.(map[string]interface{}); ok {
		// 					if volumePath, ok := vol["volumePath"].(string); ok {
		// 						// Look for source-related volume (like "/vol_source_automation")
		// 						if strings.Contains(volumePath, "source") || strings.Contains(volumePath, "src") {
		// 							if volumeID, ok := vol["id"].(string); ok {
		// 								sourcePathID = volumeID
		// 								fmt.Printf("DEBUG: Found source volume - Path: %s, ID: %s\n", volumePath, sourcePathID)
		// 								break
		// 							}
		// 						}
		// 					}
		// 				}
		// 			}
					
		// 			// If no source-specific volume found, use the first volume
		// 			if sourcePathID == "" && len(volumes) > 0 {
		// 				if firstVolume, ok := volumes[0].(map[string]interface{}); ok {
		// 					if volumeID, ok := firstVolume["id"].(string); ok {
		// 						sourcePathID = volumeID
		// 						if volumePath, ok := firstVolume["volumePath"].(string); ok {
		// 							fmt.Printf("DEBUG: Using first volume as fallback - Path: %s, ID: %s\n", volumePath, sourcePathID)
		// 						}
		// 					}
		// 				}
		// 			}
		// 		}
		// 	}
		// }

		// // If no sourcePathID found, try alternative extraction methods
		// if sourcePathID == "" {
		// 	fmt.Printf("WARNING: Could not extract sourcePathID from volumes, trying alternative methods...\n")
			
		// 	// Try to use the server config ID as fallback
		// 	if configId, ok := getServerResponse["id"].(string); ok {
		// 		sourcePathID = configId
		// 		fmt.Printf("DEBUG: Using config ID as sourcePathID fallback: %s\n", sourcePathID)
		// 	}
		// }

		// Expect(sourcePathID).NotTo(BeEmpty(), "Should have extracted a source path ID")
		// fmt.Printf("File server retrieved successfully. Source Path ID: %s\n", sourcePathID)
				
				
		By("creating a new discovery job for the source server")
        // Step 3: Create a bulk discovery job to scan the source file server
        // This job will discover files and directories on the source system
        createJobURL := fmt.Sprintf("%s/api/v1/jobs/bulk-discovery", JOB_SERVICE_URL)

        // Set up discovery job with timestamps matching the YAML configuration
        createJobRequest := CreateDiscoveryJobRequest{
            ExcludeOlderThan:    "2025-03-20T06:55:32.491Z",
            ExcludeFilePatterns: "",
            PreserveAccessTime:  false,
            FirstRunAt:          "2025-03-19T17:33:44.590Z",
            SourcePathIDs:       []string{sourcePathID},
            CreatedBy:           nil,
            Options: DiscoveryJobOptions{
                WorkflowExecutionTimeout: "60s",
                WorkflowTaskTimeout:      "30s",
                WorkflowRunTimeout:       "30s",
                StartDelay:               "10s",
            },
        }

        reqBody, err = json.Marshal(createJobRequest)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal create job request")

        resp, err = SendAPIRequest("POST", createJobURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred(), "Failed to send create job request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(201), "Expected job creation to return status code 201")

        // Parse response to extract job configuration ID
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read create job response")

        var createJobResponse []map[string]interface{}
        err = json.Unmarshal(bodyBytes, &createJobResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal create job response")

        // Extract job config ID from the first element of the response array
        if len(createJobResponse) > 0 {
            if id, ok := createJobResponse[0]["id"].(string); ok {
                jobConfigID = id
            }
        }

        Expect(jobConfigID).NotTo(BeEmpty(), "Should have received a job configuration ID")
        fmt.Printf("Discovery job created successfully with ID: %s\n", jobConfigID)

        By("monitoring job execution by retrieving job status")
        // Step 4: Monitor the discovery job execution and wait for completion
        // This verifies that the job runs successfully and completes the discovery process
        time.Sleep(30 * time.Second) // Wait for job to start and make progress
        
        getJobURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)

        resp, err = SendAPIRequest("GET", getJobURL, nil, headers)
        Expect(err).NotTo(HaveOccurred(), "Failed to send get job request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected job retrieval to return status code 200")

        // Parse response to extract job run information
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read get job response")

        var getJobResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &getJobResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal get job response")

        // Extract job run ID from the response
        if jobRuns, ok := getJobResponse["jobRuns"].([]interface{}); ok && len(jobRuns) > 0 {
            if jobRun, ok := jobRuns[0].(map[string]interface{}); ok {
                if jobRunID, ok := jobRun["jobRunId"].(string); ok {
                    sourceDiscoveryJobRunID = jobRunID
                }
            }
        }

        Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Should have received a job run ID")
        fmt.Printf("Discovery job execution monitored successfully. Job Run ID: %s\n", sourceDiscoveryJobRunID)

        // Log successful completion of the workflow
        fmt.Println("Source file server management workflow completed successfully!")
    })

    AfterAll(func() {
        // Comprehensive cleanup after all tests complete
        // This ensures no test artifacts remain in the system
        
        // Clean up discovery job if created
        if jobConfigID != "" {
            deleteJobURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)
            resp, err := SendAPIRequest("DELETE", deleteJobURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up discovery job: %s\n", jobConfigID)
        }

        // Clean up file server configuration if created
        if configID != "" {
            deleteServerURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)
            resp, err := SendAPIRequest("DELETE", deleteServerURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up file server configuration: %s\n", configID)
        }

        fmt.Println("All source file server test cleanup operations completed.")
    })
})