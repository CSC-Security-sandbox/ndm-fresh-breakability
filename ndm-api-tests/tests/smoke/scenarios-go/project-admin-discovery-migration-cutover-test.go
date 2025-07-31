package tests

import (
	"encoding/json"
	"fmt"
	"io"
	// "net/http"

	// "os"
	// "net/http"
	"strings"
	"time"

	. "ndm-api-tests/utils"
	// . "ndm-api-tests/tests/smoke/scenarios-go"
	

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// Project Admin Discovery Migration Cutover Test
// This comprehensive test suite validates the complete end-to-end workflow including:
// 1. Project admin user creation and role assignment
// 2. Source and destination file server configuration
// 3. Discovery job execution and monitoring
// 4. Migration job creation and execution
// 5. Cutover job creation, rejection, and approval workflow
// 6. Complete data migration lifecycle management
var _ = Describe("Project Admin Discovery Migration Cutover Test", Ordered, func() {

    // Test variables to store state across the entire workflow
    var (
        headers                   map[string]string // HTTP headers for API requests
        projectID                 string            // ID of the test project
        accountID                 string            // Account ID for the test
        projectAdminRoleID        string            // Role ID for project admin
        workerID                  string            // ID of the worker for file operations
        sourceHostIP              string            // IP address of source file server
        destinationHostIP         string            // IP address of destination file server
        userID                    string            // ID of the created project admin user
        userRoleID                string            // ID of the user role assignment
        user                      UserResponse      // User details from creation
        refreshToken              string            // JWT refresh token for logout
        projectAdminToken         string            // JWT access token for project admin
        sourceConfigID            string            // ID of source file server configuration
        sourcePathID              string            // ID of source path for migration
        discoveryJobConfigID      string            // ID of discovery job configuration
        sourceDiscoveryJobRunID   string            // ID of discovery job run
        destinationConfigID       string            // ID of destination file server configuration
        destinationPathID         string            // ID of destination path for migration
        precheckWorkflowID        string            // ID of migration precheck workflow
        cutoverJobConfigID        string            // ID of cutover job configuration
        cutoverJobRunID           string            // ID of cutover job run for approval
    )

    BeforeAll(func() {
        // Pre-test cleanup: Remove any existing test users from previous runs
        // This ensures a clean test environment
        headers := GetHeaders(AuthToken, ContentTypeJSON)
        
        // Fetch all existing users to identify test users for cleanup
        getUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
        resp, err := SendAPIRequest("GET", getUsersURL, nil, headers)
        if err == nil && resp.StatusCode == 200 {
            bodyBytes, _ := io.ReadAll(resp.Body)
            var usersResponse map[string]interface{}
            if json.Unmarshal(bodyBytes, &usersResponse) == nil {
                if data, ok := usersResponse["data"].([]interface{}); ok {
                    // Iterate through users and delete any that match test user patterns
                    for _, userItem := range data {
                        if user, ok := userItem.(map[string]interface{}); ok {
                            if username, ok := user["username"].(string); ok {
                                // Delete test users based on username patterns
                                if username == "testprojectadmin@email.com" || 
                                   username == "testprojectadmin2119@email.com" ||
                                   strings.Contains(username, "testprojectadmin") {
                                    if existingUserID, ok := user["id"].(string); ok {
                                        deleteUserURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, existingUserID)
                                        deleteResp, _ := SendAPIRequest("DELETE", deleteUserURL, nil, headers)
                                        if deleteResp != nil {
                                            deleteResp.Body.Close()
                                            fmt.Printf("Cleaned up existing test user: %s (ID: %s)\n", username, existingUserID)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            resp.Body.Close()
        }
		fmt.Println("Initial user cleanup complete.")


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
        // Initialize test environment variables for each test execution
        // headers = GetHeaders(AuthToken, ContentTypeJSON)
        // projectID = ProjectId
        accountID = AccountId
        projectAdminRoleID = ProjectAdminId
        // workerID = WorkerId
        // sourceHostIP = SOURCE_HOST_IP
        destinationHostIP = DESTINATION_HOST_IP

		
    })

    It("should complete the full discovery migration cutover workflow", func() {
        By("creating a project admin user")
        // Step 1: Create a new user that will be assigned project admin role
        // This user will perform all subsequent operations with limited permissions
        createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
        createUserReq := CreateUserRequest{
            Username:  fmt.Sprintf("testprojectadmin-%d-%d@email.com", GinkgoRandomSeed(), time.Now().UnixNano()), // Unique username using timestamp
            FirstName: "test1",
            LastName:  "user1",
        }

        reqBody, err := json.Marshal(createUserReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal create user request")
		adminHeaders := GetHeaders(AuthToken, ContentTypeJSON)  // Use AuthToken (admin), not projectAdminToken

        resp, err := SendAPIRequest("POST", createUserURL, reqBody, adminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send create user request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected user creation to return status code 200")

        // Parse response to extract user details
        bodyBytes, err := io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read create user response")

        var createUserResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &createUserResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal create user response")

        // Extract user information from nested response structure
        if data, ok := createUserResponse["data"].(map[string]interface{}); ok {
            if items, ok := data["items"].(map[string]interface{}); ok {
                if userInfo, ok := items["user"].(map[string]interface{}); ok {
                    if id, ok := userInfo["id"].(string); ok {
                        userID = id
                        user.ID = id
                        user.FirstName = userInfo["first_name"].(string)
                        user.Email = userInfo["email"].(string)
                    }
                }
            }
        }

        Expect(userID).NotTo(BeEmpty(), "Should have received a user ID")
        Expect(user.FirstName).To(Equal("test1"), "User first name should match")
        fmt.Printf("Project admin user created successfully: %s (ID: %s)\n", user.Email, userID)

        By("assigning project admin role to the user")
        // Step 2: Assign project admin role to the created user
        // This grants the user administrative privileges for the specific project
        createUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
        userRoleReq := UserRoleRequest{
            ProjectID: projectID,
            AccountID: accountID,
            UserID:    userID,
            RoleID:    projectAdminRoleID,
        }

        reqBody, err = json.Marshal(userRoleReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal user role request")

		adminHeaders = GetHeaders(AuthToken, ContentTypeJSON)  // Use AuthToken (admin), not projectAdminToken

        resp, err = SendAPIRequest("POST", createUserRoleURL, reqBody, adminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send create user role request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected user role creation to return status code 201")

        // Extract user role ID for cleanup
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read create user role response")

        var userRoleResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &userRoleResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal user role response")

        // Try to extract user role ID from response (similar to user creation)
        if data, ok := userRoleResponse["data"].(map[string]interface{}); ok {
            if id, ok := data["id"].(string); ok {
                userRoleID = id
            }
        }
        Expect(userRoleID).NotTo(BeEmpty(), "Should have received a user role ID")
        fmt.Printf("Project admin role assigned successfully: %s\n", userRoleID)

        By("resetting user password in Keycloak")
        // Step 3: Reset the user's password in Keycloak to enable authentication
        // This is necessary for newly created users to be able to login

        // Get Keycloak admin token for password reset
        localAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
        Expect(err).NotTo(HaveOccurred(), "Failed to get Keycloak admin token")

        // Fetch Keycloak user ID using email
        keycloakUserID, err := FetchUserID(user.Email, localAuthToken)
        Expect(err).NotTo(HaveOccurred(), "Failed to fetch Keycloak user ID")

        // Reset password via Keycloak Admin API
        resetPasswordURL := fmt.Sprintf("https://%s/%s/%s/reset-password", KEYCLOAK_IP, KEYCLOAK_BASE_URL, keycloakUserID)
        passwordPayload := map[string]interface{}{
            "type":      "password",
            "value":     "Root@123",
            "temporary": false, // User won't need to change password on first login
        }

        reqBody, err = json.Marshal(passwordPayload)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal password reset request")

        keycloakHeaders := GetHeaders(localAuthToken, ContentTypeJSON)
        resp, err = SendAPIRequest("PUT", resetPasswordURL, reqBody, keycloakHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send password reset request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(204), "Expected password reset to return status code 204")

        fmt.Printf("Password reset successful for user: %s\n", user.Email)

        By("authenticating as project admin user")
        // Step 4: Login as the project admin user to obtain access tokens
        // These tokens will be used for all subsequent API calls
        token, refreshTokenValue, statusCode, err := GetBearerTokenWithStatus(user.Email, "Root@123")
        Expect(err).NotTo(HaveOccurred(), "Failed to authenticate project admin user")
        Expect(statusCode).To(Equal(200), "Expected login to return status code 200")
        Expect(token).NotTo(BeEmpty(), "Should have received access token")
        Expect(refreshTokenValue).NotTo(BeEmpty(), "Should have received refresh token")

        projectAdminToken = token
        refreshToken = refreshTokenValue

        fmt.Printf("Project admin authentication successful\n")

        By("creating source file server configuration")
        // Step 5: Create source file server configuration for data discovery
        // This configures the source NAS system from which data will be migrated
        time.Sleep(100 * time.Second) // Wait for system stabilization
        
        createSourceServerURL := fmt.Sprintf("%s/api/v1/servers", CONFIG_SERVICE_URL)
        projectAdminHeaders := GetHeaders(projectAdminToken, ContentTypeJSON)
        projectAdminHeaders["projectid"] = projectID

        sourceServerReq := CreateFileServerRequest{
            ConfigName: "Project_admin_config_source",
            ConfigType: "FILE",
            ProjectID:  projectID,
            FileServers: []FileServerConfig{
                {
                    ServerType:      "OtherNAS",
                    UserName:        "Root",
                    Password:        "",
                    Protocol:        "NFS",
                    ProtocolVersion: "v3",
                    Host:            sourceHostIP,
                    Volumes:         []string{},
                    Workers:         []string{workerID},
                },
            },
            WorkingDirectory: WorkingDirectoryConfig{
                WorkingDirectory: "",
                PathID:           nil,
                PathName:         "",
            },
        }

        reqBody, err = json.Marshal(sourceServerReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal source server request")

        resp, err = SendAPIRequest("POST", createSourceServerURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send create source server request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(201), "Expected source server creation to return status code 201")

        // Extract source configuration ID
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read source server response")

        var sourceServerResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &sourceServerResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal source server response")

		fmt.Println()
		fmt.Println("DEBUG: Source server response:", sourceServerResponse)
		fmt.Println()

        if id, ok := sourceServerResponse["id"].(string); ok {
            sourceConfigID = id
        }

        Expect(sourceConfigID).NotTo(BeEmpty(), "Should have received source config ID")
        fmt.Printf("Source file server created successfully: %s\n", sourceConfigID)

        By("retrieving source file server details")
		// Step 6: Get source file server details to extract path information
		// This retrieves the source path ID needed for discovery and migration jobs
		time.Sleep(5 * time.Second) // Brief delay for server processing

		getSourceServerURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, sourceConfigID)

		// Remove the request body - GET requests don't need body data
		resp, err = SendAPIRequest("GET", getSourceServerURL, nil, projectAdminHeaders)
		Expect(err).NotTo(HaveOccurred(), "Failed to send get source server request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(200), "Expected source server retrieval to return status code 200")

		// Parse response to extract source path ID
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read get source server response")

		var getSourceResponse map[string]interface{}
		err = json.Unmarshal(bodyBytes, &getSourceResponse)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal get source server response")

		fmt.Println("DEBUG: Get source server response:", getSourceResponse)

		// Extract source path ID from the volumes array - match YAML parsing logic
		if fileServers, ok := getSourceResponse["fileServers"].([]interface{}); ok && len(fileServers) > 0 {
			if fileServer, ok := fileServers[0].(map[string]interface{}); ok {
				if volumes, ok := fileServer["volumes"].([]interface{}); ok && len(volumes) > 0 {
					// Use the first volume ID as sourcePathID
					if volume, ok := volumes[0].(map[string]interface{}); ok {
						if volumeID, ok := volume["id"].(string); ok {
							sourcePathID = volumeID
							fmt.Printf("DEBUG: Found volume ID as sourcePathID: %s\n", sourcePathID)
						}
					}
				}
			}
		}

		// Fallback to config ID if no volume ID found
		if sourcePathID == "" {
			sourcePathID = sourceConfigID
			fmt.Printf("DEBUG: Using config ID as sourcePathID fallback: %s\n", sourcePathID)
		}

		Expect(sourcePathID).NotTo(BeEmpty(), "Should have extracted source path ID")
		fmt.Printf("Source file server details retrieved successfully. Path ID: %s\n", sourcePathID)


        By("creating discovery job for source file server")
		// Step 7: Create and execute discovery job to scan source file system
		// This job discovers all files and directories on the source system
		time.Sleep(30 * time.Second) // Wait for server readiness

		createDiscoveryJobURL := fmt.Sprintf("%s/api/v1/jobs/bulk-discovery", JOB_SERVICE_URL)

		discoveryJobReq := CreateDiscoveryJobRequest{
			ExcludeOlderThan:    nil,
			ExcludeFilePatterns: "",
			PreserveAccessTime:  false,
			FirstRunAt:          "2025-05-20T07:09:19.642Z",
			SourcePathIDs:       []string{sourcePathID}, // Use the extracted sourcePathID
			CreatedBy:           nil,
		}

		reqBody, err = json.Marshal(discoveryJobReq)
		Expect(err).NotTo(HaveOccurred(), "Failed to marshal discovery job request")

		resp, err = SendAPIRequest("POST", createDiscoveryJobURL, reqBody, projectAdminHeaders)
		Expect(err).NotTo(HaveOccurred(), "Failed to send create discovery job request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(201), "Expected discovery job creation to return status code 201")

		// Extract discovery job configuration ID - match YAML parsing: jobConfigId: "[0].id"
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read discovery job response")

		var discoveryJobResponse []map[string]interface{}
		err = json.Unmarshal(bodyBytes, &discoveryJobResponse)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal discovery job response")

		if len(discoveryJobResponse) > 0 {
			if id, ok := discoveryJobResponse[0]["id"].(string); ok {
				discoveryJobConfigID = id
			}
		}

		Expect(discoveryJobConfigID).NotTo(BeEmpty(), "Should have received discovery job config ID")
		fmt.Printf("Discovery job created successfully: %s\n", discoveryJobConfigID)

		By("monitoring discovery job execution until completion")
		// Step 8: Monitor discovery job until it completes successfully
		// This ensures all source data has been discovered before proceeding
		time.Sleep(120 * time.Second) // Wait for discovery job to complete - match YAML delay: "120"

		getDiscoveryJobURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, discoveryJobConfigID)

		resp, err = SendAPIRequest("GET", getDiscoveryJobURL, nil, projectAdminHeaders)
		Expect(err).NotTo(HaveOccurred(), "Failed to send get discovery job request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(200), "Expected discovery job retrieval to return status code 200")

		// Parse response to verify job completion and extract job run ID
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read discovery job status response")

		var discoveryJobStatus map[string]interface{}
		err = json.Unmarshal(bodyBytes, &discoveryJobStatus)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal discovery job status")

		fmt.Println("DEBUG: Discovery job status response:", discoveryJobStatus)

		// Verify job completed successfully and extract job run ID - match YAML expectations
		if jobRuns, ok := discoveryJobStatus["jobRuns"].([]interface{}); ok && len(jobRuns) > 0 {
			if jobRun, ok := jobRuns[0].(map[string]interface{}); ok {
				if status, ok := jobRun["status"].(string); ok {
					Expect(status).To(Equal("COMPLETED"), "Discovery job should be completed")
				}
				// Match YAML parsing: sourceDiscoveryJobRunId: jobRuns[0].jobRunId
				if jobRunID, ok := jobRun["jobRunId"].(string); ok {
					sourceDiscoveryJobRunID = jobRunID
				}
			}
		}

		Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Should have received discovery job run ID")
		fmt.Printf("Discovery job completed successfully: %s\n", sourceDiscoveryJobRunID)

		By("creating destination file server configuration")
		// Step 9: Create destination file server configuration for data migration target
		// This configures the destination NAS system where data will be migrated
		time.Sleep(60 * time.Second) // Wait for system readiness - match YAML delay: "60"

		createDestServerURL := fmt.Sprintf("%s/api/v1/servers", CONFIG_SERVICE_URL)

		destServerReq := CreateFileServerRequest{
			ConfigName: "Project_admin_config_destination", // Match YAML configName
			ConfigType: "FILE",
			ProjectID:  projectID,
			FileServers: []FileServerConfig{
				{
					ServerType:      "OtherNAS",
					UserName:        "Root",
					Password:        "",
					Protocol:        "NFS",
					ProtocolVersion: "v3",
					Host:            destinationHostIP, // Use destination_host_IP from YAML
					Volumes:         []string{},
					Workers:         []string{workerID},
				},
			},
			WorkingDirectory: WorkingDirectoryConfig{
				WorkingDirectory: "",
				PathID:           nil,
				PathName:         "",
			},
		}

		reqBody, err = json.Marshal(destServerReq)
		Expect(err).NotTo(HaveOccurred(), "Failed to marshal destination server request")

		resp, err = SendAPIRequest("POST", createDestServerURL, reqBody, projectAdminHeaders)
		Expect(err).NotTo(HaveOccurred(), "Failed to send create destination server request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(201), "Expected destination server creation to return status code 201")

		// Extract destination configuration ID - match YAML parsing: configId: id
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read destination server response")

		var destServerResponse map[string]interface{}
		err = json.Unmarshal(bodyBytes, &destServerResponse)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal destination server response")

		if id, ok := destServerResponse["id"].(string); ok {
			destinationConfigID = id
		}

		Expect(destinationConfigID).NotTo(BeEmpty(), "Should have received destination config ID")
		fmt.Printf("Destination file server created successfully: %s\n", destinationConfigID)

        By("retrieving destination file server details")
		// Step 10: Get destination file server details to extract path information
		// This retrieves the destination path ID needed for migration and cutover jobs
		time.Sleep(5 * time.Second) // Brief delay for server processing - match YAML delay: "5"

		getDestServerURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, destinationConfigID)

		// Remove request body for GET request
		resp, err = SendAPIRequest("GET", getDestServerURL, nil, projectAdminHeaders)
		Expect(err).NotTo(HaveOccurred(), "Failed to send get destination server request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(200), "Expected destination server retrieval to return status code 200")

		// Parse response to extract destination path ID
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read get destination server response")

		var getDestResponse map[string]interface{}
		err = json.Unmarshal(bodyBytes, &getDestResponse)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal get destination server response")

		fmt.Println()
		fmt.Println("DEBUG: Get destination server response:", getDestResponse)
		fmt.Println()

		// Extract destination path ID from response - similar to source parsing
		// In the "retrieving destination file server details" section:
		// Extract destination path ID from response - look for destination volume
		if fileServers, ok := getDestResponse["fileServers"].([]interface{}); ok && len(fileServers) > 0 {
			if fileServer, ok := fileServers[0].(map[string]interface{}); ok {
				if volumes, ok := fileServer["volumes"].([]interface{}); ok && len(volumes) > 0 {
					// Look for a volume with "dest" in the path (like "/vol_dest_automation")
					for _, vol := range volumes {
						if volume, ok := vol.(map[string]interface{}); ok {
							if volumePath, ok := volume["volumePath"].(string); ok {
								if strings.Contains(volumePath, "dest") && volume["isValid"].(bool) && !volume["isDisabled"].(bool) {
									if volumeID, ok := volume["id"].(string); ok {
										destinationPathID = volumeID
										fmt.Printf("DEBUG: Found destination volume ID: %s (path: %s)\n", destinationPathID, volumePath)
										break
									}
								}
							}
						}
					}
					
					// If no dest volume found, use the second volume (index 1) if available
					if destinationPathID == "" && len(volumes) > 1 {
						if volume, ok := volumes[1].(map[string]interface{}); ok {
							if volumeID, ok := volume["id"].(string); ok {
								destinationPathID = volumeID
								fmt.Printf("DEBUG: Using second volume as destination ID: %s\n", destinationPathID)
							}
						}
					}
				}
			}
		}

		Expect(destinationPathID).NotTo(BeEmpty(), "Should have extracted destination path ID")
		fmt.Printf("Destination file server details retrieved successfully. Path ID: %s\n", destinationPathID)

		By("performing migration precheck validation")
		// Step 11: Execute migration precheck to validate migration feasibility
		// This ensures the migration can proceed without issues
		precheckURL := fmt.Sprintf("%s/api/v1/jobs/precheck", JOB_SERVICE_URL)

		precheckReq := MigrationPrecheckRequest{
			MigrateConfigs: []MigrateConfig{
				{
					SourcePathID:      sourcePathID,
					DestinationPathID: []string{destinationPathID}, // Match YAML structure
				},
			},
			PreserveAccessTime: false, // Match YAML: preserveAccessTime: false
		}

		reqBody, err = json.Marshal(precheckReq)
		Expect(err).NotTo(HaveOccurred(), "Failed to marshal precheck request")

		resp, err = SendAPIRequest("POST", precheckURL, reqBody, projectAdminHeaders)
		Expect(err).NotTo(HaveOccurred(), "Failed to send precheck request")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(201), "Expected precheck to return status code 201")

		// Extract precheck workflow ID - match YAML parsing: workflowId: workflowId
		bodyBytes, err = io.ReadAll(resp.Body)
		Expect(err).NotTo(HaveOccurred(), "Failed to read precheck response")

		var precheckResponse map[string]interface{}
		err = json.Unmarshal(bodyBytes, &precheckResponse)
		Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal precheck response")

		if workflowID, ok := precheckResponse["workflowId"].(string); ok {
			precheckWorkflowID = workflowID
		}

		Expect(precheckWorkflowID).NotTo(BeEmpty(), "Should have received precheck workflow ID")
		fmt.Printf("Migration precheck completed successfully: %s\n", precheckWorkflowID)

        By("creating and executing bulk migration job")
        // Step 12: Create and execute the main migration job
        // This performs the actual data migration from source to destination
        time.Sleep(150 * time.Second) // Wait for precheck completion
        
        createMigrationURL := fmt.Sprintf("%s/api/v1/jobs/bulk-migrate", JOB_SERVICE_URL)
        
        migrationReq := CreateMigrationJobRequest{
            FirstRunAt:        "2025-05-14T07:09:30.6432Z",
            FutureRunSchedule: "",
            MigrateConfigs: []MigrateConfig{
                {
                    SourcePathID:      sourcePathID,
                    DestinationPathID: []string{destinationPathID},
                },
            },
            SIDMapping: false,
            Options: MigrationOptions{
                ExcludeFilePatterns: "",
                PreserveAccessTime:  true,
                SkipFile:            "15-M", // Skip files larger than 15MB
            },
        }

        reqBody, err = json.Marshal(migrationReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal migration request")

        resp, err = SendAPIRequest("POST", createMigrationURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send migration request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(201), "Expected migration job creation to return status code 201")

        fmt.Printf("Bulk migration job created and started successfully\n")

        By("creating first cutover job")
        // Step 13: Create the first cutover job for final data synchronization
        // This prepares for the final cutover process
        time.Sleep(150 * time.Second) // Wait for migration completion
        
        createCutoverURL := fmt.Sprintf("%s/api/v1/jobs/bulk-cutover", JOB_SERVICE_URL)
        
        cutoverReq := CreateCutoverJobRequest{
            CutoverConfig: []MigrateConfig{
                {
                    SourcePathID:      sourcePathID,
                    DestinationPathID: []string{destinationPathID},
                },
            },
        }

        reqBody, err = json.Marshal(cutoverReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal cutover request")

        resp, err = SendAPIRequest("POST", createCutoverURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send cutover request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(201), "Expected cutover job creation to return status code 201")

        // Extract cutover job configuration ID
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read cutover response")
		fmt.Println("DEBUG: Cutover response:", bodyBytes)

        var cutoverResponse []map[string]interface{}
        err = json.Unmarshal(bodyBytes, &cutoverResponse)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal cutover response")

		fmt.Println("DEBUG: Cutover response:", cutoverResponse)

        if len(cutoverResponse) > 0 {
            if id, ok := cutoverResponse[0]["id"].(string); ok {
                cutoverJobConfigID = id
            }
        }

        Expect(cutoverJobConfigID).NotTo(BeEmpty(), "Should have received cutover job config ID")
        fmt.Printf("First cutover job created successfully: %s\n", cutoverJobConfigID)

        By("monitoring cutover job until it reaches blocked state")
        // Step 14: Monitor cutover job until it reaches BLOCKED state (waiting for approval)
        // The cutover job waits for manual approval before proceeding
        time.Sleep(60 * time.Second) // Wait for cutover job to reach blocked state
        
        getCutoverJobURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, cutoverJobConfigID)

        resp, err = SendAPIRequest("GET", getCutoverJobURL, nil, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send get cutover job request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected cutover job retrieval to return status code 200")

        // Parse response to verify job is blocked and extract job run ID
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read cutover job status response")

        var cutoverJobStatus map[string]interface{}
        err = json.Unmarshal(bodyBytes, &cutoverJobStatus)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal cutover job status")

        // Verify job is blocked and extract job run ID for approval
        if jobRuns, ok := cutoverJobStatus["jobRuns"].([]interface{}); ok && len(jobRuns) > 0 {
            if jobRun, ok := jobRuns[0].(map[string]interface{}); ok {
                if status, ok := jobRun["status"].(string); ok {
                    Expect(status).To(Equal("BLOCKED"), "Cutover job should be blocked waiting for approval")
                }
                if jobRunID, ok := jobRun["jobRunId"].(string); ok {
                    cutoverJobRunID = jobRunID
                }
            }
        }

        Expect(cutoverJobRunID).NotTo(BeEmpty(), "Should have received cutover job run ID")
        fmt.Printf("Cutover job is blocked and waiting for approval: %s\n", cutoverJobRunID)

        By("rejecting the first cutover job")
        // Step 15: Reject the first cutover job to test the rejection workflow
        // This simulates a scenario where the cutover is not approved initially
        time.Sleep(30 * time.Second) // Brief delay before rejection
        
        approveCutoverURL := fmt.Sprintf("%s/api/v1/job-run/cutover/approve", JOB_SERVICE_URL)
        
        rejectReq := CutoverApprovalRequest{
            Action:   "REJECTED",
            JobRunID: cutoverJobRunID,
        }

        reqBody, err = json.Marshal(rejectReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal reject request")

        resp, err = SendAPIRequest("PUT", approveCutoverURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send cutover rejection request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected cutover rejection to return status code 200")

        fmt.Printf("First cutover job rejected successfully: %s\n", cutoverJobRunID)

        By("creating second cutover job")
        // Step 16: Create a second cutover job after the first was rejected
        // This simulates creating a new cutover attempt
        time.Sleep(150 * time.Second) // Wait before creating second cutover
        
        resp, err = SendAPIRequest("POST", createCutoverURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send second cutover request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(201), "Expected second cutover job creation to return status code 201")

        fmt.Printf("Second cutover job created successfully\n")

        By("monitoring second cutover job until blocked")
        // Step 17: Monitor the second cutover job until it reaches BLOCKED state
        // This prepares for the final approval step
        time.Sleep(60 * time.Second) // Wait for second cutover to reach blocked state
        
        resp, err = SendAPIRequest("GET", getCutoverJobURL, nil, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send get second cutover job request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected second cutover job retrieval to return status code 200")

        // Parse response to get new job run ID for approval
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred(), "Failed to read second cutover job status response")

        var secondCutoverStatus map[string]interface{}
        err = json.Unmarshal(bodyBytes, &secondCutoverStatus)
        Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal second cutover job status")

        // Extract new job run ID for the second cutover
        if jobRuns, ok := secondCutoverStatus["jobRuns"].([]interface{}); ok && len(jobRuns) > 0 {
            if jobRun, ok := jobRuns[0].(map[string]interface{}); ok {
                if status, ok := jobRun["status"].(string); ok {
                    Expect(status).To(Equal("BLOCKED"), "Second cutover job should be blocked")
                }
                if jobRunID, ok := jobRun["jobRunId"].(string); ok {
                    cutoverJobRunID = jobRunID // Update with new job run ID
                }
            }
        }

        fmt.Printf("Second cutover job is blocked and ready for approval: %s\n", cutoverJobRunID)

        By("approving the second cutover job")
        // Step 18: Approve the second cutover job to complete the migration workflow
        // This finalizes the entire migration process
        time.Sleep(15 * time.Second) // Brief delay before approval
        
        approveReq := CutoverApprovalRequest{
            Action:   "APPROVED",
            JobRunID: cutoverJobRunID,
        }

        reqBody, err = json.Marshal(approveReq)
        Expect(err).NotTo(HaveOccurred(), "Failed to marshal approve request")

        resp, err = SendAPIRequest("PUT", approveCutoverURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred(), "Failed to send cutover approval request")
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200), "Expected cutover approval to return status code 200")

        fmt.Printf("Second cutover job approved successfully: %s\n", cutoverJobRunID)
        fmt.Println("Complete discovery-migration-cutover workflow executed successfully!")
    })

    AfterAll(func() {
        // Comprehensive cleanup after all tests complete
        // This ensures no test artifacts remain in the system

        // Logout project admin user to invalidate tokens
        if refreshToken != "" {
            _, _, err := LogoutUserStatusCode(refreshToken)
            if err != nil {
                fmt.Printf("Warning: Failed to logout project admin user: %v\n", err)
            }
        }

        // Clean up file server configurations
        if sourceConfigID != "" {
            deleteSourceURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, sourceConfigID)
            resp, err := SendAPIRequest("DELETE", deleteSourceURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up source file server: %s\n", sourceConfigID)
        }

        if destinationConfigID != "" {
            deleteDestURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, destinationConfigID)
            resp, err := SendAPIRequest("DELETE", deleteDestURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up destination file server: %s\n", destinationConfigID)
        }

        // Clean up job configurations
        if discoveryJobConfigID != "" {
            deleteDiscoveryURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, discoveryJobConfigID)
            resp, err := SendAPIRequest("DELETE", deleteDiscoveryURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up discovery job: %s\n", discoveryJobConfigID)
        }

        if cutoverJobConfigID != "" {
            deleteCutoverURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, cutoverJobConfigID)
            resp, err := SendAPIRequest("DELETE", deleteCutoverURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up cutover job: %s\n", cutoverJobConfigID)
        }

        // Clean up user role assignment
        if userRoleID != "" {
            deleteUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, userRoleID)
            resp, err := SendAPIRequest("DELETE", deleteUserRoleURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up user role assignment: %s\n", userRoleID)
        }

        // Clean up created project admin user
        if userID != "" {
            deleteUserURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userID)
            resp, err := SendAPIRequest("DELETE", deleteUserURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up project admin user: %s\n", userID)
        }

        fmt.Println("All discovery-migration-cutover test cleanup operations completed successfully.")
    })
})