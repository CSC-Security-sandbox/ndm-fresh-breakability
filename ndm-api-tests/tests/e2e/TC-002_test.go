package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = FDescribe("TC-002: Create a fileserver with 2 workers (1 offline) and check discovery and migration", func() {
	var headers map[string]string
	var (
		ProjectId              string
		workerId1              string
		workerId2              string
		workerIds              []string
		err                    error
		attachedWorkersConfig  map[string]SSHConfig
		destinationVolumePath1 string
		destinationVolumePath2 string
		sourceVolumePath1      string
		sourceVolumePath2      string
	)
	Context("TC-002", func() {
		BeforeEach(func() {
			NumberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 1), "Expected at least one worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[1], DESTINATION_VOLUMES[1])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], SOURCE_VOLUMES[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], SOURCE_VOLUMES[1])
		})

		It("TC-002: Create a fileserver with 2 workers (1 offline) and check discovery and migration", func() {
			By("########################## TC-002 start ################################")
			var (
				// Source-related IDs
				sourceConfigID1, sourceConfigID2 string
				sourcePathID1, sourcePathID2     string
				sourceJobConfigIDs               []string
				sourceConfigIDs                  []string
				sourceDiscoveryJobRunIDs         []string

				// Destination-related IDs
				destinationConfigID, destinationPathID, destinationPathID1 string
				destinationJobConfigID1, destinationJobConfigID2           string
				// destinationDiscoveryJobRunID1, destinationDiscoveryJobRunID2 string
				destinationJobConfigIDs []string

				// Job Config and Migration IDs
				jobConfigIDs, migrationJobConfigIDs []string
				jobConfigID1, jobConfigID2          string
				migrationJobRunID                   string
			)
			By("Creating the source file server")
			// Adding a delay because sometimes the worker takes 10 to 15 seconds to attach
			Wait(20)
			sourceParams := CreateServereParams{
				ConfigName:       "source-file-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			sourceConfigID1, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID1).NotTo(BeEmpty(), "sourceConfigID1 is empty")
			defer resp.Body.Close()

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[0], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", SOURCE_VOLUMES[1], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating the destination file server")
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
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server by configId")
			destinationPathID, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			attachedWorkersConfig := GetAttachedWorkersConfig()
			if len(attachedWorkersConfig) != 0 {
				for workerId, _ := range attachedWorkersConfig {
					DetachWorkers([]string{workerId})
					break // Detach only the first worker
				}
			}

			//waiting for worker to go offline
			Wait(WORKER_TIMEOUT)

			// Call workers api to get the worker status
			// verify if it of offline

			By("Creating a new discovery job for the source")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
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

			sourceConfigID1 = sourceJobConfigIDs[0]
			sourceConfigID2 = sourceJobConfigIDs[1]

			By("Getting jobs by jobConfigId for source")
			discovery_validators := []string{
				"src_vol_discovery.json",
				"src_vol2_discovery.json",
			}
			sourceConfigIDs = []string{sourceConfigID1, sourceConfigID2}
			sourceDiscoveryJobRunIDs = make([]string, len(sourceConfigIDs))

			for i, configID := range sourceConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(configID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

				jobRunID := getJobsResp.JobRuns[0].JobRunId
				sourceDiscoveryJobRunIDs[i] = jobRunID
				Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("sourceDiscoveryJobRunID%d should not be empty", i+1))
			}

			// Wait for both discovery jobs to complete and validate the first one
			for i, jobRunID := range sourceDiscoveryJobRunIDs {
				err := WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Source discovery job %d did not complete", i+1))

				result, err := ValidateReport(jobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error while validate PDF report")
				By(fmt.Sprintf("validate report result : %s", result))

			}

			By("Creating a new discovery job for destination")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID, destinationPathID1},
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

			destinationJobConfigID1, destinationJobConfigID2 = destinationJobConfigIDs[0], destinationJobConfigIDs[1]

			By("Getting jobs by jobConfigId for destination")

			destinationJobConfigIDs = []string{destinationJobConfigID1, destinationJobConfigID2}
			destinationDiscoveryJobRunIDs := make([]string, len(destinationJobConfigIDs))

			for i, jobConfigID := range destinationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				resp.Body.Close() // Close immediately in a loop
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

				jobRunID := getJobsResp.JobRuns[0].JobRunId
				destinationDiscoveryJobRunIDs[i] = jobRunID
				Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("destinationDiscoveryJobRunID%d should not be empty", i+1))
			}

			// Wait for both discovery jobs to complete
			for i, jobRunID := range destinationDiscoveryJobRunIDs {
				err := WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("destination discovery job %d did not complete", i+1))
			}

			By("Creating a migration job")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID, destinationPathID1},
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
				"src_to_dest_vol_migration.json",
				"src2_to_dest2_vol_migration.json",
			}

			// Get migration job run IDs and wait for completion
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
				res, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, migration_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				By(fmt.Sprintf("validate report result : %s", res))
			}

			By("Adding Delta Data")
			err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			By("Creating bulk cutover job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID, destinationPathID1},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			jobConfigID1 = jobConfigIDs[0]
			jobConfigID2 = jobConfigIDs[1]

			By("Getting jobs by job config id")
			jobConfigIDs = []string{jobConfigID1, jobConfigID2}
			idCutovers := make([]string, len(jobConfigIDs))
			for i, jobConfigID := range jobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
				defer resp.Body.Close()

				idCutover := getJobsResp.JobRuns[0].JobRunId
				idCutovers[i] = idCutover

				WaitForJobState(idCutover, BLOCKED_JOBRUN)

				getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Cutover%d job did not reach BLOCKED state", i+1))
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
				Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
				Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")
			}

			By("Approving bulk cutover job")
			resp, err = ApproveRejectBulkCutoverJob(idCutovers[0], "APPROVED", headers)
			Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			WaitForJobState(idCutovers[0], APPROVED_JOBRUN)
			// result, err := ValidateReport(idCutovers[0], JobTypeCutover, "../../validators/cutover_validation.json")
			// Expect(err).NotTo(HaveOccurred(), "Error while validate COC report")
			// LogDebug(fmt.Sprintf("validate COC  report result : %s", result))

			resp, err = ApproveRejectBulkCutoverJob(idCutovers[1], "APPROVED", headers)
			Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("########################## TC-002 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")
			err = RemoveDeltaFromVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)

			err = RemoveDeltaFromVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath2)

			err = ClearVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)

			err = ClearVolume(destinationVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath2)

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})
	})
})
