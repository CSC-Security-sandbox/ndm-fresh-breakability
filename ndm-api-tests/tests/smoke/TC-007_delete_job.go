package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-007_delete_job: Test job deletion with and without active job runs", func() {
	var (
		ProjectId             string
		workerId              string
		workerIds             []string
		err                   error
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		migrationJobID1       string
		migrationJobID2       string
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
	)

	Context("TC-007_delete_job", func() {
		BeforeEach(func() {
			// Use global shared project and workers instead of creating new ones
			ProjectId, _, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least 1 worker in global environment")

			workerIds = GetWorkerIds()
			workerId = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Setup test volumes (create clones for test isolation)
			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			Expect(err).To(BeNil(), "Error setting up test volumes")

			// DeferCleanup ensures cleanup happens even if test fails or is interrupted
			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes in DeferCleanup: %v", err))
				}
			})
		})

		It("TC-007_delete_job: Test job deletion scenarios with active and inactive job runs", func() {
			By("########################## TC-007_delete_job start ################################")

			var (
				sourceConfigID      string
				destinationConfigID string
				sourcePathID1       string
				sourcePathID2       string
				destinationPathID1  string
				destinationPathID2  string
			)

			By("Creating source file server")
			uniqueID := uuid.New().String()[:8]
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("source-delete-test-%s", uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[0],
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "Source config ID should not be empty")
			defer resp.Body.Close()

			By("Getting source export path IDs")
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting source path ID 1")
			Expect(sourcePathID1).NotTo(BeEmpty(), "Source path ID 1 should not be empty")

			sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting source path ID 2")
			Expect(sourcePathID2).NotTo(BeEmpty(), "Source path ID 2 should not be empty")

			By("Creating destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("dest-delete-test-%s", uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
			Expect(destinationConfigID).NotTo(BeEmpty(), "Destination config ID should not be empty")
			defer resp.Body.Close()

			By("Getting destination export path IDs")
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting destination path ID 1")
			Expect(destinationPathID1).NotTo(BeEmpty(), "Destination path ID 1 should not be empty")

			destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting destination path ID 2")
			Expect(destinationPathID2).NotTo(BeEmpty(), "Destination path ID 2 should not be empty")

			By("Creating first migration job")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}
			migrationJobIDs1, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating first migration job")
			Expect(len(migrationJobIDs1)).To(BeNumerically(">", 0), "Should create at least one migration job")
			migrationJobID1 = migrationJobIDs1[0]
			defer resp.Body.Close()

			By("Creating second migration job")
			migrationParams = MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID2},
				DestinationPathIDs: []string{destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}
			migrationJobIDs2, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating second migration job")
			Expect(len(migrationJobIDs2)).To(BeNumerically(">", 0), "Should create at least one migration job")
			migrationJobID2 = migrationJobIDs2[0]
			defer resp.Body.Close()

			By("Verifying jobs were created successfully")
			job1Details, _, err := GetJobRunDetails(migrationJobID1, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job 1 details")
			Expect(job1Details.JobConfigId).To(Equal(migrationJobID1), "Job 1 ID should match")

			job2Details, _, err := GetJobRunDetails(migrationJobID2, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job 2 details")
			Expect(job2Details.JobConfigId).To(Equal(migrationJobID2), "Job 2 ID should match")

			By("Checking if first job has active runs")
			updatedJob1Details, _, err := GetJobRunDetails(job1Details.JobConfigId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting updated job 1 details")

			// Check if there are any job runs with active statuses
			hasActiveRuns := false
			if len(updatedJob1Details.JobRuns) > 0 {
				for _, jobRun := range updatedJob1Details.JobRuns {
					// Check for active statuses: Ready Running, Pausing, Stopping
					if jobRun.Status == "Ready" ||
						jobRun.Status == "Running" {
						hasActiveRuns = true
						break
					}
				}
			}

			By("Attempting to delete job with active runs (should fail)")
			if hasActiveRuns {
				deleteResp, err := DeleteJob(migrationJobID1, headers)
				Expect(err).To(HaveOccurred(), "Should get error when deleting job with active runs")
				Expect(deleteResp.StatusCode).To(Equal(http.StatusBadRequest), "Should return 400 Bad Request")
			}

			By("Waiting for second job to complete before deletion")
			// Get the job runs for the second job and wait for them to complete
			job2DetailsUpdated, _, err := GetJobRunDetails(migrationJobID2, headers, true)
			Expect(err).NotTo(HaveOccurred(), "Error getting job 2 details")

			fmt.Printf("job2Details: %+v\n", job2DetailsUpdated)

			if len(job2DetailsUpdated.JobRuns) > 0 {
				for _, jobRun := range job2DetailsUpdated.JobRuns {
					// Wait for each job run to reach completed state
					err = WaitForJobState(jobRun.JobRunId, "COMPLETED")
					Expect(err).NotTo(HaveOccurred(), "Job run %s did not reach COMPLETED state", jobRun.JobRunId)
				}
			}

			By("Attempting to delete job without active runs (should succeed)")
			deleteResp2, err := DeleteJob(migrationJobID2, headers)
			Expect(err).NotTo(HaveOccurred(), "Should successfully delete job without active runs")
			Expect(deleteResp2.StatusCode).To(Equal(http.StatusOK), "Should return 200 OK")

			By("Verifying job was actually deleted")
			_, resp, err = GetJobRunDetails(migrationJobID2, headers)
			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK), "Should not return 200 OK for deleted job")

			By("Verifying first job still exists")
			_, resp, err = GetJobRunDetails(migrationJobID1, headers)
			Expect(err).NotTo(HaveOccurred(), "First job should still exist")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Should return 200 OK when fetching existing job")

			By("Waiting for first job run to complete")
			// Get the job runs for the first job and wait for them to complete
			job1DetailsUpdated, _, err := GetJobRunDetails(migrationJobID1, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job 1 details")

			if len(job1DetailsUpdated.JobRuns) > 0 {
				for _, jobRun := range job1DetailsUpdated.JobRuns {
					// Wait for each job run to reach completed state
					err = WaitForJobState(jobRun.JobRunId, "COMPLETED")
					Expect(err).NotTo(HaveOccurred(), "Job run %s did not reach COMPLETED state", jobRun.JobRunId)
				}
			}

			By("Testing role-based permissions for job deletion")
			// Create a test user for role-based testing
			By("Creating test user for role testing")
			username := fmt.Sprintf("jobdeletetest%d@email.com", GinkgoRandomSeed())
			firstName := "JobDelete"
			lastName := "TestUser"
			testUser, err := CreateNewUser(username, firstName, lastName, headers)
			Expect(err).NotTo(HaveOccurred(), "Error while creating test user")
			testUserId := testUser["id"].(string)
			userEmail := testUser["email"].(string)

			// Reset user password
			By("Setting up test user credentials")
			keycloakToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error getting Keycloak admin token")
			keycloakUserID, err := FetchUserID(userEmail, keycloakToken)
			Expect(err).NotTo(HaveOccurred(), "Error fetching user ID from Keycloak")
			err = ResetUserPassword(keycloakUserID, keycloakToken, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error resetting user password via Keycloak")

			// Test with project viewer role first
			By("Testing job deletion with project viewer role (should fail)")
			viewerRoleData, err := CreateUserRole(ProjectId, AccountId, testUserId, ProjectViewerId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating project viewer role")
			viewerRoleId := viewerRoleData["id"].(string)

			// Login as project viewer
			viewerToken, _, err := GetBearerToken(userEmail, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error logging in as project viewer")
			viewerHeaders := GetHeaders(viewerToken, ContentTypeJSON)
			viewerHeaders["project_id"] = ProjectId

			// Attempt to delete first job as viewer (should fail)
			deleteRespViewer, err := DeleteJob(migrationJobID1, viewerHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending delete job API request as viewer")
			defer deleteRespViewer.Body.Close()
			Expect(deleteRespViewer.StatusCode).To(Equal(http.StatusForbidden), "Project viewer should not be able to delete jobs (expected 403)")
			By("Project viewer correctly restricted from deleting job")

			// Clean up viewer role before creating admin role
			DeleteUserRolesByIDs([]string{viewerRoleId})

			// Test with project admin role
			By("Testing job deletion with project admin role (should succeed)")
			adminRoleData, err := CreateUserRole(ProjectId, AccountId, testUserId, ProjectAdminId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating project admin role")
			adminRoleId := adminRoleData["id"].(string)

			// Login as project admin
			adminToken, _, err := GetBearerToken(userEmail, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error logging in as project admin")
			adminHeaders := GetHeaders(adminToken, ContentTypeJSON)
			adminHeaders["projectid"] = ProjectId

			// Attempt to delete first job as admin (should succeed)
			deleteRespAdmin, err := DeleteJob(migrationJobID1, adminHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending delete job API request as admin")
			defer deleteRespAdmin.Body.Close()
			Expect(deleteRespAdmin.StatusCode).To(Equal(http.StatusOK), "Project admin should be able to delete jobs (expected 200)")
			By("Project admin successfully deleted job")

			// Verify job was deleted
			By("Verifying job was deleted by project admin")
			_, resp, err = GetJobRunDetails(migrationJobID1, headers)
			Expect(err).To(HaveOccurred(), "Should get error when trying to fetch deleted job")
			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK), "Should not return 200 OK for deleted job")

			// Clean up test user and roles
			DeleteUserRolesByIDs([]string{adminRoleId, viewerRoleId})
			DeleteUserByID(testUserId)

			By("########################## TC-007_delete_job end ################################")
		})

		AfterEach(func() {
			By("Cleaning up test volumes after test run")
			err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}
			// Workers and project cleanup handled by SynchronizedAfterSuite
		})
	})
})
