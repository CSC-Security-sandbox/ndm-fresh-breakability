
package tests

import (
	"encoding/json"
	"fmt"
	"io"
	. "ndm-api-tests/utils"
	"net/http"
	// "strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Project Admin Discovery Migration Cutover Test daksh", Ordered, func() {
    var (
        ProjectId             string
        workerId              string
        headers               map[string]string
        
        // User-related variables
        userId               string
        userRoleId           string
        testUser             map[string]interface{}
        
        // Server configuration variables
        sourceConfigId       string
        destinationConfigId  string
        sourcePathId         string
        destinationPathId    string
        
        // Job-related variables
        discoveryJobConfigId string
        discoveryJobRunId    string
        cutoverJobConfigId    string
        cutoverJobRunId       string
    )

    BeforeAll(func() {
        // Initialize test environment and perform any necessary cleanup
        fmt.Println("Initializing App Admin Source File Server Test environment.")

        // Create project using the correct function signature
        projectID, err := createProject(AuthToken, AccountId)
        ProjectId = projectID
        if err != nil {
            Fail(fmt.Sprintf("Failed to create project: %v", err))
        }
        fmt.Printf("Project created with ID: %s\n", ProjectId)

        headers = GetHeaders(AuthToken, ContentTypeJSON)

        // Get available worker IDs by calling the workers API
        workersURL := fmt.Sprintf("%s/api/v1/workers", JOB_SERVICE_URL)
        workersHeaders := GetHeaders(AuthToken, ContentTypeJSON)
        workersResp, err := SendAPIRequest("GET", workersURL, nil, workersHeaders)
        
        if err != nil {
            fmt.Printf("DEBUG: Error getting workers: %v\n", err)
            workerId = "fallback-worker-id"
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
        
        // Log the variables being used
        fmt.Printf("DEBUG: Using project_id: %s\n", ProjectId)
        fmt.Printf("DEBUG: Using workerId: %s\n", workerId)
        fmt.Printf("DEBUG: Using sourceHostIP: %s\n", SOURCE_HOST_IP)
        
        // Verify we have required variables
        Expect(ProjectId).NotTo(BeEmpty(), "Project ID should not be empty")
        Expect(SOURCE_HOST_IP).NotTo(BeEmpty(), "Source Host IP should not be empty")

        fmt.Printf("Test environment initialized - ProjectID: %s, WorkerID: %s, SourceHost: %s\n",
            ProjectId, workerId, SOURCE_HOST_IP)
    })

    AfterAll(func() {
        destinationVolumePath := fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME)
        clearVolumeErr := ClearVolume(destinationVolumePath)
        Expect(clearVolumeErr).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath)

        LogDebug("Cleaning up test environment")
        cleanUpErr := CleanupTestEnv()
        Expect(cleanUpErr).To(BeNil(), "Error during test environment cleanup")
    })

    Context("Project Admin Complete Workflow", func() {
        It("Should complete the full discovery migration cutover workflow", func() {
            
            By("Creating a new user")
            // Create user data
            createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)

            userData := map[string]interface{}{
                "username":  fmt.Sprintf("testprojectadmin-%d-%d@email.com", GinkgoRandomSeed(), time.Now().UnixNano()), 
                "firstName": "test1",
                "lastName":  "user1",
            }
            
            // Make API call to create user
            reqBody, err := json.Marshal(userData)
            resp, err := SendAPIRequest("POST", createUserURL, reqBody, headers)
            Expect(err).NotTo(HaveOccurred(), "Error creating user")
            
            defer resp.Body.Close()
            Expect(resp.StatusCode).To(Equal(200), "Expected HTTP 200 OK")
            
            // Parse response to get user details
            bodyBytes, err := io.ReadAll(resp.Body)
            Expect(err).NotTo(HaveOccurred(), "Failed to read create user response")

            var userResponse map[string]interface{}
            err = json.Unmarshal(bodyBytes, &userResponse)
            Expect(err).NotTo(HaveOccurred(), "Error parsing user creation response")

            if data, ok := userResponse["data"].(map[string]interface{}); ok {
                if items, ok := data["items"].(map[string]interface{}); ok {
                    if userInfo, ok := items["user"].(map[string]interface{}); ok {
                        testUser = userInfo
                        if id, ok := userInfo["id"].(string); ok {
                            userId = id
                        }
                    }
                }
            }

            Expect(userId).NotTo(BeEmpty(), "Should have received a user ID")
            Expect(testUser["first_name"]).To(Equal("test1"), "User first name should match")
            fmt.Printf("Project admin user created successfully: %s (ID: %s)\n", testUser["email"], userId)

            By("Assigning project admin role to user")
            createUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)

            userRoleReq := map[string]interface{}{
                "project_id": ProjectId,
                "account_id": AccountId,
                "user_id":    userId,
                "role_id":    ProjectAdminId,
            }

            reqBody, err = json.Marshal(userRoleReq)
            Expect(err).NotTo(HaveOccurred(), "Failed to marshal user role request")

            adminHeaders := GetHeaders(AuthToken, ContentTypeJSON)
            resp, err = SendAPIRequest("POST", createUserRoleURL, reqBody, adminHeaders)
            Expect(err).NotTo(HaveOccurred(), "Failed to send create user role request")
            defer resp.Body.Close()
            Expect(resp.StatusCode).To(Equal(200), "Expected user role creation to return status code 200")

            // Extract user role ID for cleanup
            bodyBytes, err = io.ReadAll(resp.Body)
            Expect(err).NotTo(HaveOccurred(), "Failed to read create user role response")

            var userRoleResponse map[string]interface{}
            err = json.Unmarshal(bodyBytes, &userRoleResponse)
            Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal user role response")

            // Try to extract user role ID from response
            if data, ok := userRoleResponse["data"].(map[string]interface{}); ok {
                if id, ok := data["id"].(string); ok {
                    userRoleId = id
                }
            }
            Expect(userRoleId).NotTo(BeEmpty(), "Should have received a user role ID")
            fmt.Printf("Project admin role assigned successfully: %s\n", userRoleId)

            By("Resetting user password in Keycloak")
            localAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
            Expect(err).NotTo(HaveOccurred(), "Failed to get Keycloak admin token")

            // Fetch Keycloak user ID using email
            keycloakUserID, err := FetchUserID(testUser["email"].(string), localAuthToken)
            Expect(err).NotTo(HaveOccurred(), "Failed to fetch Keycloak user ID")

            // Reset password via Keycloak Admin API
            resetPasswordURL := fmt.Sprintf("https://%s/%s/%s/reset-password", KEYCLOAK_IP, KEYCLOAK_BASE_URL, keycloakUserID)
            passwordPayload := map[string]interface{}{
                "type":      "password",
                "value":     "Root@123",
                "temporary": false,
            }

            reqBody, err = json.Marshal(passwordPayload)
            Expect(err).NotTo(HaveOccurred(), "Failed to marshal password reset request")

            keycloakHeaders := GetHeaders(localAuthToken, ContentTypeJSON)
            resp, err = SendAPIRequest("PUT", resetPasswordURL, reqBody, keycloakHeaders)
            Expect(err).NotTo(HaveOccurred(), "Failed to send password reset request")
            defer resp.Body.Close()
            Expect(resp.StatusCode).To(Equal(204), "Expected password reset to return status code 204")

            fmt.Printf("Password reset successful for user: %s\n", testUser["email"])

            By("Logging in with project admin credentials")
            token, refreshTokenValue, statusCode, err := GetBearerTokenWithStatus(testUser["email"].(string), "Root@123")
            Expect(err).NotTo(HaveOccurred(), "Failed to authenticate project admin user")
            Expect(statusCode).To(Equal(200), "Expected login to return status code 200")
            Expect(token).NotTo(BeEmpty(), "Should have received access token")
            Expect(refreshTokenValue).NotTo(BeEmpty(), "Should have received refresh token")

            fmt.Printf("Project admin authentication successful\n")

            By("Creating the source file server")
            sourceParams := CreateServereParams{
                ConfigName:       "Project_admin_config_source",
                ConfigType:       ConfigTypeFile,
                ProjectID:        ProjectId,
                ServerType:       ServerTypeOtherNAS,
                UserName:         "Root",
                Password:         "",
                Protocol:         ProtocolNFS,
                ProtocolVersion:  ProtocolVersion3,
                Host:             SOURCE_HOST_IP,
                Workers:          []string{workerId},
                WorkingDirectory: "",
            }
            
            sourceConfigId, resp, err = CreateFileServer(sourceParams, headers)
            Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
            Expect(sourceConfigId).NotTo(BeEmpty(), "Source config ID should not be empty")
            Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            defer resp.Body.Close()
            
            Wait(5) // Wait for server initialization

            By("Getting source file server details")
            sourcePathId, err = GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigId, headers)
            Expect(err).NotTo(HaveOccurred(), "Error getting source export path ID")
            Expect(sourcePathId).NotTo(BeEmpty(), "Source path ID should not be empty")

            By("Creating and running discovery job for source")
            jobParams := DiscoveryJobParams{
                SourcePathIDs:            []string{sourcePathId},
                ExcludeOlderThan:         nil,
                ExcludeFilePatterns:      "",
                PreserveAccessTime:       false,
                FirstRunAt:               GetCurrentUTCTimestamp(),
                CreatedBy:                nil,
                WorkflowExecutionTimeout: "60s",
                WorkflowTaskTimeout:      "30s",
                WorkflowRunTimeout:       "30s",
                StartDelay:               "30s",
            }
            
            discoveryJobConfigIds, resp, err := CreateDiscoveryJob(jobParams, headers)
            Expect(err).NotTo(HaveOccurred(), "Error creating discovery job")
            Expect(len(discoveryJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one job config ID")
            Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            defer resp.Body.Close()
            
            discoveryJobConfigId = discoveryJobConfigIds[0]
            Wait(30) // Wait for job initialization

            By("Waiting for discovery job completion")
            jobConfigDetails, resp, err := GetJobRunDetails(discoveryJobConfigId, headers, false)
            Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            defer resp.Body.Close()
            
            Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
            discoveryJobRunId = jobConfigDetails.JobRuns[0].JobRunId
            Expect(discoveryJobRunId).NotTo(BeEmpty(), "Discovery job run ID should not be empty")
            
            // Wait for discovery to complete
            err = WaitForJobState(discoveryJobRunId, COMPLETED_JOBRUN)
            Expect(err).NotTo(HaveOccurred(), "Discovery job should complete successfully")

            By("Creating the destination file server")
            destinationParams := CreateServereParams{
                ConfigName:       "Project_admin_config_destination",
                ConfigType:       ConfigTypeFile,
                ProjectID:        ProjectId,
                ServerType:       ServerTypeOtherNAS,
                UserName:         "Root",
                Password:         "",
                Protocol:         ProtocolNFS,
                ProtocolVersion:  ProtocolVersion3,
                Host:             DESTINATION_HOST_IP,
                Workers:          []string{workerId},
                WorkingDirectory: "",
            }
            
            destinationConfigId, resp, err = CreateFileServer(destinationParams, headers)
            Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
            Expect(destinationConfigId).NotTo(BeEmpty(), "Destination config ID should not be empty")
            Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            defer resp.Body.Close()
            
            Wait(5) // Wait for server initialization

            By("Getting destination file server details")
            destinationPathId, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigId, headers)
            Expect(err).NotTo(HaveOccurred(), "Error getting destination export path ID")
            Expect(destinationPathId).NotTo(BeEmpty(), "Destination path ID should not be empty")

            By("Running pre-check migration")
            precheckData := map[string]interface{}{
                "migrateConfigs": []map[string]interface{}{
                    {
                        "sourcePathId": sourcePathId,
                        "destinationPathId": []string{destinationPathId},
                    },
                },
                "preserveAccessTime": false,
            }
            precheckURL := fmt.Sprintf("%s/api/v1/jobs/precheck", JOB_SERVICE_URL)
            reqBody, err = json.Marshal(precheckData)
            Expect(err).NotTo(HaveOccurred(), "Failed to marshal precheck request")
            resp, err = SendAPIRequest("POST", precheckURL, reqBody, headers)

            Expect(err).NotTo(HaveOccurred(), "Error running pre-check migration")
            Expect(resp.StatusCode).To(Equal(201), "Expected HTTP 201 CREATED")
            defer resp.Body.Close()
            
            bodyBytes, err = io.ReadAll(resp.Body)
            Expect(err).NotTo(HaveOccurred(), "Failed to read precheck response")

            var precheckResponse map[string]interface{}
            err = json.Unmarshal(bodyBytes, &precheckResponse)
            Expect(err).NotTo(HaveOccurred(), "Failed to unmarshal precheck response")
            
            workflowId := precheckResponse["workflowId"].(string)
            Expect(workflowId).NotTo(BeEmpty(), "Workflow ID should not be empty")
            fmt.Printf("Migration precheck completed successfully: %s\n", workflowId)

            By("Creating and running migration job")
            migrationParams := MigrationJobParams{
                FirstRunAt:         GetCurrentUTCTimestamp(),
                FutureRunSchedule:  "",
                SourcePathIDs:      []string{sourcePathId},
                DestinationPathIDs: []string{destinationPathId},
                SidMapping:         false,
                Options: map[string]interface{}{
                    "excludeFilePatterns": "",
                    "preserveAccessTime":  true,
                    "skipFile":            "15-M",
                },
            }
            
            migrationJobConfigIds, resp, err := CreateMigrationJob(migrationParams, headers)
            Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
            Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            defer resp.Body.Close()

            fmt.Println("DEBUG: Migration job config IDs:", migrationJobConfigIds)
            
            Expect(len(migrationJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one migration job config ID")
            Wait(500)// Wait as specified in YAML



            // By("Creating first bulk cutover job")

            // Expect(sourcePathId).NotTo(BeEmpty(), "Source path ID should not be empty")
            // Expect(destinationPathId).NotTo(BeEmpty(), "Destination path ID should not be empty")
            // fmt.Printf("DEBUG: About to create cutover job - sourcePathId: %s, destinationPathId: %s\n", sourcePathId, destinationPathId)


            // cutoverParams := BulkCutoverJobParams{
            //     SourcePathIDs:      []string{sourcePathId},
            //     DestinationPathIDs: []string{destinationPathId},
            // }
            
            
            // // cutoverJobConfigIds, resp, err := CreateBulkCutoverJob(cutoverParams, headers)

            // payload := map[string]interface{}{
            //     "cutoverConfig": cutoverParams,
            // }

            // payloadBytes, err := json.Marshal(payload)
            // createBulkCutoverURL := JOB_SERVICE_URL + CREATE_CUTOVER_ENDPOINT

            // if err != nil {
            //     fmt.Printf("ERROR: Failed to marshal payload for second cutover job: %v\n", err)
            // }

            // Second_resp, err := SendAPIRequest("POST", createBulkCutoverURL, payloadBytes, headers)

            // if err != nil {
            //     fmt.Printf("ERROR: CreateBulkCutoverJob (second) failed with error: %v\n", err)
            // }

            // bodyBytes, err = io.ReadAll(Second_resp.Body)

            // if err != nil {
            //     fmt.Printf("ERROR: Failed to read response body: %v\n", err)
            // }

            // var bulkCutoverResp []map[string]interface{}
            // err = json.Unmarshal(bodyBytes, &bulkCutoverResp)

            // var jobConfigIDs []string
            // for _, job := range bulkCutoverResp {
            //     if id, ok := job["id"].(string); ok && id != "" {
            //         jobConfigIDs = append(jobConfigIDs, id)
            //     }
            // }

            // secondCutoverJobConfigIds := jobConfigIDs

            // fmt.Printf("DEBUG: Second cutover job config IDs: %v\n", secondCutoverJobConfigIds)

            // fmt.Printf("DEBUG: Second cutover API response: %v\n", bulkCutoverResp)

            // fmt.Println()

            // fmt.Println(Second_resp)
            
            // if err != nil {
            //     fmt.Printf("ERROR: CreateBulkCutoverJob failed with error: %v\n", err)
            //     if resp != nil && resp.Body != nil {
            //         bodyBytes, _ := io.ReadAll(resp.Body)
            //         fmt.Printf("ERROR: Response body: %s\n", string(bodyBytes))
            //     }
            // }

            // Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
            // Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            // defer resp.Body.Close()

            // fmt.Printf("DEBUG: Cutover job config IDs: %v\n", secondCutoverJobConfigIds)

            // Expect(len(secondCutoverJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")
            // cutoverJobConfigId = secondCutoverJobConfigIds[0]
            // Wait(150) // Wait as specified in YAML

            By("Creating cutover job with proper error handling")
            cutoverParams := BulkCutoverJobParams{
                SourcePathIDs:      []string{sourcePathId},
                DestinationPathIDs: []string{destinationPathId},
            }

            // Fix: Build the cutover config as expected by the API
            var cutoverConfigs []map[string]interface{}
            minLen := len(cutoverParams.SourcePathIDs)
            if len(cutoverParams.DestinationPathIDs) < minLen {
                minLen = len(cutoverParams.DestinationPathIDs)
            }
            for i := 0; i < minLen; i++ {
                cutoverConfigs = append(cutoverConfigs, map[string]interface{}{
                    "sourcePathId":      cutoverParams.SourcePathIDs[i],
                    "destinationPathId": []string{cutoverParams.DestinationPathIDs[i]},
                })
            }

            payload := map[string]interface{}{
                "cutoverConfig": cutoverConfigs,
            }

            payloadBytes, err := json.Marshal(payload)
            Expect(err).NotTo(HaveOccurred())

            createBulkCutoverURL := JOB_SERVICE_URL + CREATE_CUTOVER_ENDPOINT
            cutoverResp, err := SendAPIRequest("POST", createBulkCutoverURL, payloadBytes, headers)
            Expect(err).NotTo(HaveOccurred())
            defer cutoverResp.Body.Close()

            fmt.Printf("DEBUG: Cutover response status: %d\n", cutoverResp.StatusCode)

            bodyBytes, err = io.ReadAll(cutoverResp.Body)
            Expect(err).NotTo(HaveOccurred())

            fmt.Printf("DEBUG: Response body: %s\n", string(bodyBytes))

            // Handle both object and array responses
            var jobConfigIDs []string

            // First try to unmarshal as array
            var bulkCutoverRespArray []map[string]interface{}
            if err := json.Unmarshal(bodyBytes, &bulkCutoverRespArray); err == nil {
                // Successfully unmarshaled as array
                for _, job := range bulkCutoverRespArray {
                    if id, ok := job["id"].(string); ok && id != "" {
                        jobConfigIDs = append(jobConfigIDs, id)
                    }
                }
            } else {
                // Try to unmarshal as single object
                var bulkCutoverRespObject map[string]interface{}
                if err := json.Unmarshal(bodyBytes, &bulkCutoverRespObject); err == nil {
                    if id, ok := bulkCutoverRespObject["id"].(string); ok && id != "" {
                        jobConfigIDs = append(jobConfigIDs, id)
                    }
                } else {
                    Fail(fmt.Sprintf("Failed to parse cutover response as either array or object: %v", err))
                }
            }

            fmt.Printf("DEBUG: Extracted job config IDs: %v\n", jobConfigIDs)
            Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")

            cutoverJobConfigId = jobConfigIDs[0]
            Wait(30)

            By("Waiting for cutover job to reach BLOCKED state")
            jobConfigDetails, resp, err = GetJobRunDetails(cutoverJobConfigId, headers, false)
            Expect(err).NotTo(HaveOccurred(), "Error getting cutover job run details")
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            defer resp.Body.Close()

            fmt.Println(jobConfigDetails)
            
            Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
            cutoverJobRunId = jobConfigDetails.JobRuns[0].JobRunId
            Expect(cutoverJobRunId).NotTo(BeEmpty(), "Cutover job run ID should not be empty")
            
            // Wait for job to reach BLOCKED state
            err = WaitForJobState(cutoverJobRunId, BLOCKED_JOBRUN)

            jobConfigDetails, resp, err = GetJobRunDetails(cutoverJobConfigId, headers, false)
            Expect(err).NotTo(HaveOccurred(), "Error getting updated cutover job details")
            defer resp.Body.Close()

            Expect(err).NotTo(HaveOccurred(), "Cutover job should reach BLOCKED state")
            
            // Verify the status is BLOCKED
            Expect(jobConfigDetails.JobRuns[0].Status).To(Equal("BLOCKED"), "Job status should be BLOCKED")
            Wait(60) // Wait as specified in YAML

            By("Rejecting the first cutover job")
            resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunId, "REJECTED", headers)
            Expect(err).NotTo(HaveOccurred(), "Error rejecting bulk cutover job")
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            defer resp.Body.Close()
            
            Wait(30) // Wait as specified in YAML

            // By("Creating second bulk cutover job")
            // secondCutoverJobConfigIds, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
            // Expect(err).NotTo(HaveOccurred(), "Error creating second bulk cutover job")
            // Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            // defer resp.Body.Close()

            // fmt.Printf("DEBUG: Second cutover job config IDs: %v\n", secondCutoverJobConfigIds)


            // Expect(len(secondCutoverJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")
            // fmt.Printf("DEBUG: Second cutover job config IDs: %v\n", secondCutoverJobConfigIds)
            // secondCutoverJobConfigId := secondCutoverJobConfigIds[0]
            // Wait(50) // Wait as specified in YAML

            // ...existing code...
            // By("Rejecting the first cutover job")
            // resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunId, "REJECTED", headers)
            // Expect(err).NotTo(HaveOccurred(), "Error rejecting bulk cutover job")
            // Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            // defer resp.Body.Close()

            // // Wait for the rejection to be processed and job to reach a terminal state
            // fmt.Println("DEBUG: Waiting for first cutover job to be fully rejected...")
            // Wait(60) // Increased wait time to ensure proper state transition

            // resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunId, "REJECTED", headers)
            // Expect(err).NotTo(HaveOccurred(), "Error rejecting bulk cutover job")
            // Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            // defer resp.Body.Close()

            // // Wait for the rejection to be processed and job to reach a terminal state
            // fmt.Println("DEBUG: Waiting for first cutover job to be fully rejected...")
            // Wait(120) // Increased wait time even more

            // // Check multiple times to ensure the job is fully terminated
            // for i := 0; i < 3; i++ {
            //     jobConfigDetails, resp, err = GetJobRunDetails(cutoverJobConfigId, headers, false)
            //     Expect(err).NotTo(HaveOccurred(), "Error getting first cutover job details after rejection")
            //     defer resp.Body.Close()
                
            //     fmt.Printf("DEBUG: First cutover job status check %d: %s\n", i+1, jobConfigDetails.JobRuns[0].Status)
                
            //     if jobConfigDetails.JobRuns[0].Status == "REJECTED" {
            //         break
            //     }
                
            //     Wait(30) // Additional wait between checks
            // }

            // fmt.Printf("DEBUG: Final first cutover job status: %s\n", jobConfigDetails.JobRuns[0].Status)

            // By("Creating second bulk cutover job")
            // // Recreate the cutover parameters to ensure fresh request
            // secondCutoverParams := BulkCutoverJobParams{
            //     SourcePathIDs:      []string{sourcePathId},
            //     DestinationPathIDs: []string{destinationPathId},

            // }

            // payload = map[string]interface{}{
            //     "cutoverConfig": secondCutoverParams,
            // }

            // payloadBytes, err = json.Marshal(payload)
            // createBulkCutoverURL = JOB_SERVICE_URL + CREATE_CUTOVER_ENDPOINT

            // if err != nil {
            //     fmt.Printf("ERROR: Failed to marshal payload for second cutover job: %v\n", err)
            // }

            // Second_resp, err := SendAPIRequest("POST", createBulkCutoverURL, payloadBytes, headers)

            // if err != nil {
            //     fmt.Printf("ERROR: CreateBulkCutoverJob (second) failed with error: %v\n", err)
            // }

            // bodyBytes, err = io.ReadAll(Second_resp.Body)

            // if err != nil {
            //     fmt.Printf("ERROR: Failed to read response body: %v\n", err)
            // }

            // var bulkCutoverResp []map[string]interface{}
            // err = json.Unmarshal(bodyBytes, &bulkCutoverResp)

            // var jobConfigIDs1[]string
            // for _, job := range bulkCutoverResp {
            //     if id, ok := job["id"].(string); ok && id != "" {
            //         jobConfigIDs = append(jobConfigIDs1, id)
            //     }
            // }

            // secondCutoverJobConfigIds := jobConfigIDs

            // fmt.Printf("DEBUG: Second cutover job config IDs: %v\n", secondCutoverJobConfigIds)

            // fmt.Printf("DEBUG: Second cutover API response: %v\n", bulkCutoverResp)

            // fmt.Println()

            // fmt.Println(Second_resp)

            // fmt.Printf("DEBUG: Creating second cutover with sourcePathId: %s, destinationPathId: %s\n", sourcePathId, destinationPathId)
            // fmt.Printf("DEBUG: Migration job config IDs were: %v\n", migrationJobConfigIds)
            // fmt.Printf("DEBUG: First cutover job config ID was: %s\n", cutoverJobConfigId)

            // // secondCutoverJobConfigIds, resp, err := CreateBulkCutoverJob(secondCutoverParams, headers)

            // var responseBody string
            // if resp != nil && resp.Body != nil {
            //     bodyBytes, readErr := io.ReadAll(resp.Body)
            //     if readErr == nil {
            //         responseBody = string(bodyBytes)
            //         fmt.Printf("DEBUG: Second cutover API response body: '%s'\n", responseBody)
            //         fmt.Printf("DEBUG: Response body length: %d\n", len(responseBody))
            //         // Reset the body for other readers
            //         resp.Body = io.NopCloser(strings.NewReader(responseBody))
            //     } else {
            //         fmt.Printf("DEBUG: Error reading response body: %v\n", readErr)
            //     }
            // } else {
            //     fmt.Printf("DEBUG: Response or response body is nil\n")
            // }
            
            // // Check for empty response body
            // if responseBody == "" {
            //     fmt.Printf("ERROR: API returned empty response body but 201 status code\n")
            //     fmt.Printf("ERROR: This indicates a backend issue with second cutover job creation\n")
            //     Fail("Second cutover job API returned empty response body")
            // }

            // if err != nil {
            //     fmt.Printf("ERROR: CreateBulkCutoverJob (second) failed with error: %v\n", err)
            //     fmt.Printf("ERROR: Response status: %d\n", resp.StatusCode)
            //     fmt.Printf("ERROR: Response body: '%s'\n", responseBody)
            //     Fail("CreateBulkCutoverJob failed for second cutover job")
            // }

            // fmt.Printf("DEBUG: Second cutover API response status: %d\n", resp.StatusCode)
            // fmt.Printf("DEBUG: Second cutover job config IDs returned: %v\n", secondCutoverJobConfigIds)

            // // Check if the returned ID matches migration job ID
            // for _, migrationID := range migrationJobConfigIds {
            //     if len(secondCutoverJobConfigIds) > 0 && secondCutoverJobConfigIds[0] == migrationID {
            //         fmt.Printf("ERROR: Second cutover job returned migration job ID: %s\n", migrationID)
            //         fmt.Printf("ERROR: This indicates the API is not creating a new cutover job\n")
            //         fmt.Printf("ERROR: API Response: '%s'\n", responseBody)
                    
            //         // Additional debugging - let's see if we can inspect the CreateBulkCutoverJob function behavior
            //         fmt.Printf("ERROR: Function returned migration job ID instead of new cutover job\n")
            //         fmt.Printf("ERROR: This suggests either API bug or function parsing issue\n")
                    
            //         Fail("Second cutover job creation returned migration job ID instead of new cutover job ID")
            //     }
            // }

            // Expect(err).NotTo(HaveOccurred(), "Error creating second bulk cutover job")
            // Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            // defer resp.Body.Close()

            // fmt.Printf("DEBUG: Second cutover job config IDs: %v\n", secondCutoverJobConfigIds)
            // fmt.Printf("DEBUG: First cutover job config ID was: %s\n", cutoverJobConfigId)

            // Expect(len(secondCutoverJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")

            // secondCutoverJobConfigId := secondCutoverJobConfigIds[0]

            // // Verify that the second job config ID is different from the first one
            // Expect(secondCutoverJobConfigId).NotTo(Equal(cutoverJobConfigId), "Second cutover job config ID should be different from first one")

            // fmt.Printf("DEBUG: Second cutover job config ID: %s (different from first: %s)\n", secondCutoverJobConfigId, cutoverJobConfigId)

            // Wait(150) // Wait as specified in YAML
            // // ...existing code...

            // fmt.Printf("DEBUG: Second cutover job config ID: %s\n", secondCutoverJobConfigId)

            By("Creating second bulk cutover job")
            // Recreate the cutover parameters to ensure fresh request
            secondCutoverParams := BulkCutoverJobParams{
                SourcePathIDs:      []string{sourcePathId},
                DestinationPathIDs: []string{destinationPathId},
            }

            // Fix: Build the cutover config as expected by the API (same as first cutover)
            var secondCutoverConfigs []map[string]interface{}
            minLen = len(secondCutoverParams.SourcePathIDs)
            if len(secondCutoverParams.DestinationPathIDs) < minLen {
                minLen = len(secondCutoverParams.DestinationPathIDs)
            }
            for i := 0; i < minLen; i++ {
                secondCutoverConfigs = append(secondCutoverConfigs, map[string]interface{}{
                    "sourcePathId":      secondCutoverParams.SourcePathIDs[i],
                    "destinationPathId": []string{secondCutoverParams.DestinationPathIDs[i]},
                })
            }

            payload = map[string]interface{}{
                "cutoverConfig": secondCutoverConfigs,
            }

            payloadBytes, err = json.Marshal(payload)
            Expect(err).NotTo(HaveOccurred())

            createBulkCutoverURL = JOB_SERVICE_URL + CREATE_CUTOVER_ENDPOINT
            Second_resp, err := SendAPIRequest("POST", createBulkCutoverURL, payloadBytes, headers)
            Expect(err).NotTo(HaveOccurred())
            defer Second_resp.Body.Close()

            fmt.Printf("DEBUG: Second cutover response status: %d\n", Second_resp.StatusCode)

            bodyBytes, err = io.ReadAll(Second_resp.Body)
            Expect(err).NotTo(HaveOccurred())

            fmt.Printf("DEBUG: Second cutover response body: %s\n", string(bodyBytes))

            // Handle both object and array responses for second cutover (same logic as first)
            var secondJobConfigIDs []string

            // First try to unmarshal as array
            var secondBulkCutoverRespArray []map[string]interface{}
            if err := json.Unmarshal(bodyBytes, &secondBulkCutoverRespArray); err == nil {
                // Successfully unmarshaled as array
                for _, job := range secondBulkCutoverRespArray {
                    if id, ok := job["id"].(string); ok && id != "" {
                        secondJobConfigIDs = append(secondJobConfigIDs, id)
                    }
                }
            } else {
                // Try to unmarshal as single object
                var secondBulkCutoverRespObject map[string]interface{}
                if err := json.Unmarshal(bodyBytes, &secondBulkCutoverRespObject); err == nil {
                    if id, ok := secondBulkCutoverRespObject["id"].(string); ok && id != "" {
                        secondJobConfigIDs = append(secondJobConfigIDs, id)
                    }
                } else {
                    Fail(fmt.Sprintf("Failed to parse second cutover response as either array or object: %v", err))
                }
            }

            secondCutoverJobConfigIds := secondJobConfigIDs

            fmt.Printf("DEBUG: Second cutover job config IDs: %v\n", secondCutoverJobConfigIds)

            // Check if the returned ID matches migration job ID
            for _, migrationID := range migrationJobConfigIds {
                if len(secondCutoverJobConfigIds) > 0 && secondCutoverJobConfigIds[0] == migrationID {
                    fmt.Printf("ERROR: Second cutover job returned migration job ID: %s\n", migrationID)
                    Fail("Second cutover job creation returned migration job ID instead of new cutover job ID")
                }
            }

            Expect(Second_resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
            Expect(len(secondCutoverJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")

            secondCutoverJobConfigId := secondCutoverJobConfigIds[0]

            // Verify that the second job config ID is different from the first one
            Expect(secondCutoverJobConfigId).NotTo(Equal(cutoverJobConfigId), "Second cutover job config ID should be different from first one")

            fmt.Printf("DEBUG: Second cutover job config ID: %s (different from first: %s)\n", secondCutoverJobConfigId, cutoverJobConfigId)

            Wait(150) // Wait as specified in YAML


            By("Waiting for second cutover job to reach BLOCKED state")
            jobConfigDetails, resp, err = GetJobRunDetails(secondCutoverJobConfigId, headers, false)
            Expect(err).NotTo(HaveOccurred(), "Error getting second cutover job run details")
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            defer resp.Body.Close()

            fmt.Println(jobConfigDetails)
            
            Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
            cutoverJobRunId = jobConfigDetails.JobRuns[0].JobRunId
            Expect(cutoverJobRunId).NotTo(BeEmpty(), "Second cutover job run ID should not be empty")
            

            // Wait for job to reach BLOCKED state
            err = WaitForJobState(cutoverJobRunId, BLOCKED_JOBRUN)

            fmt.Println("DEBUG: Waiting for job to reach BLOCKED state")
            if err != nil {
                fmt.Printf("ERROR: WaitForJobState failed with error: %v\n", err)
            }

            jobConfigDetails, resp, err = GetJobRunDetails(secondCutoverJobConfigId, headers, false)
            Expect(err).NotTo(HaveOccurred(), "Error getting updated cutover job details")
            defer resp.Body.Close()

            Expect(err).NotTo(HaveOccurred(), "Second cutover job should reach BLOCKED state")
            
            // Verify the status is BLOCKED
            Expect(jobConfigDetails.JobRuns[0].Status).To(Equal("BLOCKED"), "Job status should be BLOCKED")
            Wait(60) // Wait as specified in YAML

            By("Approving the second cutover job")
            resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunId, "APPROVED", headers)
            Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job")
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            defer resp.Body.Close()
            
            Wait(15) // Wait as specified in YAML
        })
    })
})