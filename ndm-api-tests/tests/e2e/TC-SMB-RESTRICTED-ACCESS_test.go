package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = FDescribe("TC-SMB-RESTRICTED-ACCESS: Create a fileserver with a single worker and check discovery and migration", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB restricted access test is skipped as it is not supported in NFS")
		}
	})
	var (
		ProjectId              string
		workerId1              string
		workerIds              []string
		err                    error
		destinationVolumePath1 string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
		sourceVolumePath1      string
	)

	Context("TC-SMB-RESTRICTED-ACCESS", func() {
		BeforeEach(func() {
			numberOfWorker := 1
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[5], SOURCE_VOLUMES[5])
		})

		It("TC-SMB-RESTRICTED-ACCESS: Create a fileserver with 1 worker and check discovery and migration", func() {
			By("########################## TC-SMB-RESTRICTED-ACCESS start ################################")

			var sourceConfigID, sourcePathID1 string
			var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
			var destinationConfigID, destinationPathID1 string

			sourceParams := CreateServereParams{
				ConfigName:       "source-file-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[5],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}

			By(fmt.Sprintf("Creating Source File Server : %s", SOURCE_HOST_IPs[5]))
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			By(fmt.Sprintf("Source file server created with config ID: %#v", resp))

			By("Getting the Source File Server Export Path ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[5], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			LogDebug(fmt.Sprintf("Source File Server Export Path ID : [%s]", sourcePathID1))

			By("Creating a Bulk Discovery Job for the Source File Server")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1},
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
			sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()

			discovery_validators := []string{
				"tc_restricted_discovery.json",
			}
			for i, sourceJobConfigID := range sourceJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()

				sourceDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

				// Wait for discovery jobs to complete
				err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", sourceDiscoveryJobRunID)

				result, err := ValidateReport(sourceDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", "SMB-PERMISSIONS", discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
				LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job : %s = %s", sourceDiscoveryJobRunID, result))
			}

			By(fmt.Sprintf("Creating Destination File Server : %s", DESTINATION_HOST_IPs[0]))
			destinationParams := CreateServereParams{
				ConfigName:       "destination-file-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting the Destination File Server Export Path ID")
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			LogDebug(fmt.Sprintf("Destination File Server Export Path ID : [%s]", destinationPathID1))

			By("Creating a Bulk Discovery Job for the Destination File Server")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1},
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
			destinationJobConfigIDs, resp, err = CreateDiscoveryJob(destinationJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for destination: %v", err))
			defer resp.Body.Close()

			for _, destinationJobConfigID := range destinationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(destinationJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()
				destinationDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(destinationDiscoveryJobRunID).NotTo(BeEmpty(), "Destination Discovery JobRun ID should not be empty")

				// Wait for discovery jobs to complete
				err = WaitForJobState(destinationDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", destinationDiscoveryJobRunID)
			}

			By("Creating a Bulk Migration Job")
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
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			migration_validators := []string{
				"tc_restricted_migration.json",
			}
			// Get migration job run IDs and wait for completion
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				result, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/%s/%s", "SMB-PERMISSIONS", migration_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				LogDebug(fmt.Sprintf("validate report result : %s", result))
			}

			By("Adding Delta Data to the Source Paths")
			err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)

			By("Creating a Bulk Cutover Job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			By("Getting jobs by job config id")
			for _, jobConfigID := range jobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID for config %s", jobConfigID)
				defer resp.Body.Close()

				cutoverRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(cutoverRunID).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", cutoverRunID)

				WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)
				// Fetch the latest status
				getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", jobConfigID)
				defer resp.Body.Close()

				Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found for config %s", jobConfigID)
				Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", jobConfigID)
				Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected status BLOCKED for config %s", jobConfigID)

				cutoverRunIDs = append(cutoverRunIDs, cutoverRunID)
			}

			By("Approving Bulk Cutover Job")
			for _, cutoverRunID := range cutoverRunIDs {
				resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverRunID)
				defer resp.Body.Close()
			}

			// By("Validating cutover reports")
			// for _, cutoverRunID := range cutoverRunIDs {
			// 	result, err := ValidateReport(cutoverRunID, JobTypeCutover, fmt.Sprintf("../../validators/%s/cutover_validation.json", PROTOCOL_TYPE))
			// 	Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
			// 	LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			// }
			By("########################## TC-SMB-RESTRICTED-ACCESS end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")
			err = RemoveDeltaFromVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)

			err = ClearVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup completed")
		})
	})
})
