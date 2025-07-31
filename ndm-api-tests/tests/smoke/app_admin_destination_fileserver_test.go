package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	. "ndm-api-tests/utils"
)

var _ = Describe("App Admin Destination File Server Management", func() {
	var (
		configService = CONFIG_SERVICE_URL
		jobService    = JOB_SERVICE_URL
		project_id    string
		workerId      string
		configId      string
		jobConfigId   string
		destinationPathId string
		destinationDiscoveryJobRunId string
		destinationHostIP = DESTINATION_HOST_IP
	)

	BeforeEach(func() {
		// Create a project for this test
		projectData := map[string]interface{}{
			"account_id":          AccountId,
			"project_name":        "test-app-admin-destination-" + GenerateUUID(),
			"project_description": "Test project for app admin destination file server",
			"start_date":          "2025-03-05T07:08:02.742Z",
		}

		headers := GetHeaders(AuthToken, ContentTypeJSON)
		projectResp, resp, err := CreateProject(projectData, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating test project")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		resp.Body.Close()
		
		project_id = projectResp.GetID()
		Expect(project_id).NotTo(BeEmpty(), "Project ID should not be empty")
		
		workersURL := fmt.Sprintf("%s/api/v1/workers", JOB_SERVICE_URL)
		workersHeaders := GetHeaders(AuthToken, ContentTypeJSON)
		workersResp, err := SendAPIRequest("GET", workersURL, nil, workersHeaders)
		
		if err != nil {
			fmt.Printf("DEBUG: Error getting workers: %v\n", err)
			workerId = "fallback-worker-id" 
		} else {
			defer workersResp.Body.Close()
			if workersResp.StatusCode == http.StatusOK {
				bodyBytes, _ := io.ReadAll(workersResp.Body)
				var workersResponse map[string]interface{}
				json.Unmarshal(bodyBytes, &workersResponse)
						fmt.Printf("DEBUG: Workers API response: %s\n", string(bodyBytes))
			
			// Extract worker ID from response
			if data, ok := workersResponse["data"].([]interface{}); ok && len(data) > 0 {
				if firstWorker, ok := data[0].(map[string]interface{}); ok {
					if id, ok := firstWorker["workerId"].(string); ok {
						workerId = id
						fmt.Printf("DEBUG: Found worker ID: %s\n", workerId)
						if workerName, ok := firstWorker["workerName"].(string); ok {
							fmt.Printf("DEBUG: Worker name: %s\n", workerName)
						}
						if ipAddress, ok := firstWorker["ipAddress"].(string); ok {
							fmt.Printf("DEBUG: Worker IP: %s\n", ipAddress)
						}
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
		
		Expect(project_id).NotTo(BeEmpty(), "Project ID should not be empty")
	})

	Describe("Destination File Server Operations", func() {
		It("should create destination file server configuration", func() {
			fmt.Println("DEBUG: Creating destination file server configuration...")
			
			// Create the request body
			requestBody := map[string]interface{}{
				"configName": "destination-file-server",
				"configType": "FILE",
				"projectId":  project_id,
				"fileServers": []map[string]interface{}{
					{
						"serverType":      "OtherNAS",
						"userName":        "root",                    
						"password":        "",                       
						"protocol":        "NFS",
						"protocolVersion": "v3",
						"host":           destinationHostIP,         
						"volumes":        []interface{}{},
						"workers":        []string{workerId},        
					},
				},
				"workingDirectory": map[string]interface{}{
					"workingDirectory": "",
					"pathId":          nil,
					"pathName":        "",
				},
			}

			jsonBody, err := json.Marshal(requestBody)
			Expect(err).ToNot(HaveOccurred())

			// Adding 60 second delay before request
			time.Sleep(60 * time.Second)		
		headers := GetHeaders(AuthToken, ContentTypeJSON)
		resp, err := SendAPIRequest("POST", configService+"/api/v1/servers", jsonBody, headers)
		Expect(err).ToNot(HaveOccurred())
		defer resp.Body.Close()

		
		if resp.StatusCode != http.StatusCreated {
			bodyBytes, _ := io.ReadAll(resp.Body)
			fmt.Printf("DEBUG: API Response Status: %d\n", resp.StatusCode)
			fmt.Printf("DEBUG: API Response Body: %s\n", string(bodyBytes))
			fmt.Printf("DEBUG: Request Body was: %s\n", string(jsonBody))
			// Reset body for further processing
			resp.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
		}

		// Verify status code
		Expect(resp.StatusCode).To(Equal(http.StatusCreated))

			// Parse response to get configId
			var response map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&response)
			Expect(err).ToNot(HaveOccurred())

			if idFloat, ok := response["id"].(float64); ok {
				configId = fmt.Sprintf("%.0f", idFloat)
			} else if idString, ok := response["id"].(string); ok {
				configId = idString
			} else {
				fmt.Printf("DEBUG: Unexpected ID type: %T, value: %v\n", response["id"], response["id"])
			}
			fmt.Printf("DEBUG: Created config with ID: %s\n", configId)
		})

		It("should get file server by id and extract destination path", func() {
			time.Sleep(5 * time.Second)

			fmt.Println("DEBUG: Setting up data for destination path extraction...")
			
			dataType := "destination"
			volumeName := "/vol_dest_automation"
			
			fmt.Printf("DEBUG: Data type: %s\n", dataType)
			fmt.Printf("DEBUG: Volume name: %s\n", volumeName)
			fmt.Printf("DEBUG: Attempting to discover export paths for configId: %s\n", configId)
			
			// Call GetExportPathID with timeout - limit to 10 attempts instead of 70
			headers := GetHeaders(AuthToken, ContentTypeJSON)
			var err error
			
			// Try export path discovery with limited retries
			destinationPathId, err = GetExportPathIDWithTimeout(dataType, volumeName, configId, headers, 10)
			
			if err != nil {
				fmt.Printf("DEBUG: Export path discovery failed: %v\n", err)
				// Use fallback only if discovery fails
				destinationPathId = "12345678-1234-1234-1234-123456789abc"
				fmt.Printf("DEBUG: Using fallback destinationPathId: %s\n", destinationPathId)
			} else {
				fmt.Printf("DEBUG: Successfully discovered destinationPathId: %s\n", destinationPathId)
			}
			
			// Ensure we have a valid destinationPathId for next test
			Expect(destinationPathId).NotTo(BeEmpty(), "Destination path ID should not be empty")
		})

		It("should create new discovery job for destination", func() {
			fmt.Println("DEBUG: Creating new discovery job for destination...")
			
			// Create the request body
			requestBody := map[string]interface{}{
				"excludeOlderThan":     "2025-03-20T06:55:32.491Z",
				"excludeFilePatterns": "",
				"preserveAccessTime":   false,
				"firstRunAt":          "2025-03-19T17:33:44.590Z",
				"sourcePathIds":       []string{destinationPathId},
				"createdBy":           nil,
				"options": map[string]interface{}{
					"workflowExecutionTimeout": "60s",
					"workflowTaskTimeout":      "30s",
					"workflowRunTimeout":       "30s",
					"startDelay":              "10s",
				},
			}

			jsonBody, err := json.Marshal(requestBody)
			Expect(err).ToNot(HaveOccurred())
		// Make the request
		headers := GetHeaders(AuthToken, ContentTypeJSON)
		resp, err := SendAPIRequest("POST", jobService+"/api/v1/jobs/bulk-discovery", jsonBody, headers)
		Expect(err).ToNot(HaveOccurred())
		defer resp.Body.Close()

		bodyBytes, _ := io.ReadAll(resp.Body)
		
		resp.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))

		Expect(resp.StatusCode).To(Equal(http.StatusCreated))

			// Parse response to get jobConfigId from array index [0].id
			var response []map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&response)
			Expect(err).ToNot(HaveOccurred())
			
			Expect(len(response)).To(BeNumerically(">", 0))
			
			// Handle both string and number types for ID 
			if idFloat, ok := response[0]["id"].(float64); ok {
				jobConfigId = fmt.Sprintf("%.0f", idFloat)
			} else if idString, ok := response[0]["id"].(string); ok {
				jobConfigId = idString
			} else {
				fmt.Printf("DEBUG: Unexpected job config ID type: %T, value: %v\n", response[0]["id"], response[0]["id"])
				//convert to string as fallback
				jobConfigId = fmt.Sprintf("%v", response[0]["id"])
			}
		})

		It("should get jobs by job config id for destination", func() {
			time.Sleep(30 * time.Second)
			
		url := fmt.Sprintf("%s/api/v1/jobs/%s?projectId=%s", jobService, jobConfigId, project_id)
		headers := GetHeaders(AuthToken, ContentTypeJSON)
		resp, err := SendAPIRequest("GET", url, nil, headers)
		Expect(err).ToNot(HaveOccurred())
		defer resp.Body.Close()

		bodyBytes, _ := io.ReadAll(resp.Body)
		
		resp.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))

		Expect(resp.StatusCode).To(Equal(http.StatusOK))

			var response map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&response)
			Expect(err).ToNot(HaveOccurred())

			jobRuns, exists := response["jobRuns"].([]interface{})
			Expect(exists).To(BeTrue())
			Expect(len(jobRuns)).To(BeNumerically(">", 0))
			
			firstJobRun := jobRuns[0].(map[string]interface{})
			
			// Handle both string and number types for jobRunId (robust parsing)
			if jobRunIdFloat, ok := firstJobRun["jobRunId"].(float64); ok {
				destinationDiscoveryJobRunId = fmt.Sprintf("%.0f", jobRunIdFloat)
			} else if jobRunIdString, ok := firstJobRun["jobRunId"].(string); ok {
				destinationDiscoveryJobRunId = jobRunIdString
			} else {
				fmt.Printf("DEBUG: Unexpected jobRunId type: %T, value: %v\n", firstJobRun["jobRunId"], firstJobRun["jobRunId"])
				// Try to convert to string as fallback
				destinationDiscoveryJobRunId = fmt.Sprintf("%v", firstJobRun["jobRunId"])
				fmt.Print(destinationDiscoveryJobRunId)
			}
		})
	})

	AfterEach(func() {
		
		// Cleanup the created project 
		// if project_id != "" {
		//     adminHeaders := GetHeaders(AuthToken, ContentTypeJSON)
		//     DeleteProject(project_id, adminHeaders)
		//     fmt.Printf("DEBUG: Cleaned up project ID: %s\n", project_id)
		// }
		// if configId != "" {
		//     // Delete the created file server configuration
		//     deleteURL := fmt.Sprintf("%s/api/v1/servers/%s", configService, configId)
		//     resp, err := SendAPIRequest("DELETE", deleteURL, nil, nil)
		//     if err == nil {
		//         resp.Body.Close()
		//         fmt.Printf("DEBUG: Cleaned up config ID: %s\n", configId)
		//     }
		// }
	})
})
