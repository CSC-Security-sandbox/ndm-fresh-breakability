package tests
import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

//why is ordered required here?
var _ = Describe("Project Admin Discovery Migration Cutover Test daksh", func() {
    var (
        projectId             string
        workerId              string
        headers               map[string]string
        userIDs               []interface{}
        usernames             []string
        userRoleIDs           []string
        sourceConfigId        string
        destinationConfigId   string
        sourcePathId          string
        destinationPathId     string
        discoveryJobConfigId  string
        discoveryJobRunId     string
        cutoverJobConfigId    string
        cutoverJobRunId       string
		destinationVolumePath1 string
		sourceVolumePath1      string
        password               string
        keycloakAuthToken      string
        userKeycloakID         string
        authToken              string
        refreshToken           string
        resp                   *http.Response
    )

    BeforeEach(func() {
		headers = GetHeaders(AuthToken, ContentTypeJSON)
        //remove this
        fmt.Println("Headers initialized for test execution.")
        numberOfWorker := 1
        ProjectID, attachedWorkersConfig, err := SetupTestEnv(numberOfWorker)
        Expect(err).To(BeNil(), "Error during test environment setup")
        Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
        workerIds := GetWorkerIds()
        workerId = workerIds[0]
        projectId = ProjectID
        destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
        sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], SOURCE_VOLUMES[0])
	})

    AfterEach(func() {
        // Cleanup user roles
        var roleIDs []string
        for _, roleID := range userRoleIDs {
            if roleID != "" {
                roleIDs = append(roleIDs, roleID)
            }
        }
        if len(roleIDs) > 0 {
            DeleteUserRolesByIDs(roleIDs)
        }
        
        // Cleanup users
        for _, userID := range userIDs {
            if userID != nil {
                DeleteUserByID(userID.(string))
            }
        }
        
        // Cleanup Keycloak users
        for _, username := range usernames {
            if username != "" {
                DeleteKeycloakUser(username)
            }
        }

        err := RemoveDeltaFromVolume(sourceVolumePath1)
        Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)
        LogDebug(fmt.Sprintf("Restored original data to source volume: %s", sourceVolumePath1))

        err = ClearVolume(destinationVolumePath1)
        Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)
        LogDebug(fmt.Sprintf("Cleared volume of destination: %s", destinationVolumePath1))

        err = CleanupTestEnv()
        Expect(err).To(BeNil(), "Error during test environment cleanup")
        LogDebug("Test environment cleanup complete.")
        By("Cleanup complete.")

        LogDebug("All source file server test cleanup operations completed.")
    })

    It("Should complete the full discovery migration cutover workflow", func() {
        By("########################## Project Admin E2E Tests Begins ################################")

        By("Creating a new user")
        usernames = make([]string, 1)
        userIDs = make([]interface{}, 1)
        userRoleIDs = make([]string, 1)
        
        usernames[0] = fmt.Sprintf("testprojectadmin-%d-%d@email.com", GinkgoRandomSeed(), time.Now().UnixNano())
        responseData, err := CreateNewUser(usernames[0], "test1", "user1", headers)
        Expect(err).To(BeNil())
        userIDs[0] = responseData["id"]
        Expect(responseData["first_name"]).To(Equal("test1"))
        Expect(userIDs[0]).ToNot(BeNil())

        

        By("Assigning project admin role to user")
        roleData, err := CreateUserRole(projectId, AccountId, userIDs[0].(string), ProjectAdminId, headers)
        Expect(err).To(BeNil())
        userRoleIDs[0] = fmt.Sprintf("%v", roleData["id"])
        Expect(userRoleIDs[0]).ToNot(BeEmpty())

        

        By("Resetting user password in Keycloak")
        password = "Root@123"
        keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
        Expect(err).To(BeNil())
        userKeycloakID, err = FetchUserID(usernames[0], keycloakAuthToken)
        Expect(err).To(BeNil())
        err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
        password = PASSWORD
        Expect(err).To(BeNil())

        By("Logging in with project admin credentials")
        authToken, refreshToken, err = GetBearerToken(usernames[0], password)
        Expect(err).To(BeNil())
        Expect(authToken).ToNot(BeEmpty())
        Expect(refreshToken).ToNot(BeEmpty())

        headers = GetProjectIdHeader(authToken, projectId)



        By("Creating the source file server")
        sourceParams := CreateServereParams{
            ConfigName:       "Project_admin_config_source",
            ConfigType:       ConfigTypeFile,
            ProjectID:        projectId,
            ServerType:       ServerTypeOtherNAS,
            UserName:         PROTOCOL_USERNAME,
            Password:         PROTOCOL_PASSWORD,
            Protocol:         PROTOCOL_TYPE,
            ProtocolVersion:  ProtocolVersion3,
            Host:             SOURCE_HOST_IPs[0],
            Workers:          []string{workerId},
            WorkingDirectory: "",
        }
        
        sourceConfigId, resp, err = CreateFileServer(sourceParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
        Expect(sourceConfigId).NotTo(BeEmpty(), "Source config ID should not be empty")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()

        By("Getting source file server details")
        sourcePathId, err = GetExportPathID("source", SOURCE_VOLUMES[0], sourceConfigId, headers)
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
            StartDelay:               "10s",
        }
        
        discoveryJobConfigIds, resp, err := CreateDiscoveryJob(jobParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating discovery job")
        Expect(len(discoveryJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one job config ID")
        defer resp.Body.Close()
        
        discoveryJobConfigId = discoveryJobConfigIds[0]

        By("Waiting for discovery job completion")
        jobConfigDetails, resp, err := GetJobRunDetails(discoveryJobConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()
        
        Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
        discoveryJobRunId = jobConfigDetails.JobRuns[0].JobRunId
        Expect(discoveryJobRunId).NotTo(BeEmpty(), "Discovery job run ID should not be empty")
        
        err = WaitForJobState(discoveryJobRunId, COMPLETED_JOBRUN)
        Expect(err).NotTo(HaveOccurred(), "Discovery job should complete successfully")

        By("Creating the destination file server")
        destinationParams := CreateServereParams{
            ConfigName:       "Project_admin_config_destination",
            ConfigType:       ConfigTypeFile,
            ProjectID:        projectId,
            ServerType:       ServerTypeOtherNAS,
            UserName:         PROTOCOL_USERNAME,
            Password:         PROTOCOL_PASSWORD,
            Protocol:         PROTOCOL_TYPE,
            ProtocolVersion:  ProtocolVersion3,
            Host:             DESTINATION_HOST_IPs[0],
            Workers:          []string{workerId},
            WorkingDirectory: "",
        }
        
        destinationConfigId, resp, err = CreateFileServer(destinationParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
        Expect(destinationConfigId).NotTo(BeEmpty(), "Destination config ID should not be empty")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()

        By("Getting destination file server details")
        destinationPathId, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting destination export path ID")
        Expect(destinationPathId).NotTo(BeEmpty(), "Destination path ID should not be empty")

        By("Creating and running migration job")
        migrationParams := MigrationJobParams{
            FirstRunAt:         GetCurrentUTCTimestamp(),
            FutureRunSchedule:  "",
            SourcePathIDs:      []string{sourcePathId},
            DestinationPathIDs: []string{destinationPathId},
            SidMapping:         false,
            Options: map[string]interface{}{
                "excludeFilePatterns": "*/snapshots/*, */logs/*, */tmp/*",
                "preserveAccessTime":  true,
                "skipFile":            "15-M",
            },
        }
        
        migrationJobConfigIds, resp, err := CreateMigrationJob(migrationParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
        defer resp.Body.Close()

        fmt.Println("DEBUG: Migration job config IDs:", migrationJobConfigIds)
        Expect(len(migrationJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one migration job config ID")
        
        for _, migrationJobConfigID := range migrationJobConfigIds {
            getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
            migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
            Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
            defer resp.Body.Close()
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
            err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
            Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
        }

        By("Creating first bulk cutover job")
        cutoverParams := BulkCutoverJobParams{
            SourcePathIDs:      []string{sourcePathId},
            DestinationPathIDs: []string{destinationPathId},
        }

        jobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
        defer resp.Body.Close()

        Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")
        cutoverJobConfigId = jobConfigIDs[0]

        By("Waiting for cutover job to reach BLOCKED state")
        jobConfigDetails, resp, err = GetJobRunDetails(cutoverJobConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting cutover job run details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()
        
        Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
        cutoverJobRunId = jobConfigDetails.JobRuns[0].JobRunId
        Expect(cutoverJobRunId).NotTo(BeEmpty(), "Cutover job run ID should not be empty")
        
        err = WaitForJobState(cutoverJobRunId, BLOCKED_JOBRUN)
        Expect(err).NotTo(HaveOccurred(), "Cutover job should reach BLOCKED state")
        
        jobConfigDetails, resp, err = GetJobRunDetails(cutoverJobConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting updated cutover job details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()
        
        Expect(len(jobConfigDetails.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found")
        Expect(jobConfigDetails.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected status BLOCKED")

        By("Rejecting the first cutover job")
        resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunId, "REJECTED", headers)
        Expect(err).NotTo(HaveOccurred(), "Error rejecting bulk cutover job")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()

    })
   
})
