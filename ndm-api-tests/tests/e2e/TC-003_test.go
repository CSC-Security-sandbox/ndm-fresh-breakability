package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-003: Create a fileserver with healthy workers and run scheduled discovery and migration", func() {
	var (
		ProjectId              string
		workerId1              string
		workerId2              string
		workerIds              []string
		err                    error
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
		destinationVolumePath1 string
		destinationVolumePath2 string
		sourceVolumePath1      string
		sourceVolumePath2      string
	)
	Context("TC-003", func() {
		BeforeEach(func() {
			numberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, DESTINATION_VOLUMES[0])
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, DESTINATION_VOLUMES[1])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, SOURCE_VOLUMES[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, SOURCE_VOLUMES[1])
		})

		It("TC-003: Create a fileserver with healthy workers and run scheduled discovery and migration", func() {
			By("########################## TC-003 start ################################")
			var sourceConfigID, sourcePathID1, sourcePathID2 string
			var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
			var destinationConfigID, destinationPathID1, destinationPathID2 string

			By("Creating the source file server")
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
				Host:             SOURCE_HOST_IP,
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", SOURCE_VOLUMES[1], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a new discovery job for the source")

			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "",
				PreserveAccessTime:       false,
				FirstRunAt:               GetFutureUTCTimestamp(120),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
			Expect(len(sourceJobConfigIDs)).To(BeNumerically(">", 0), "No valid sourceJobConfigIDs found in response")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
			Wait(10)
			By("Validating run not initiates on triggering Discovery if it is scheduled")
			for _, sourceJobConfigID := range sourceJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers, false)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", sourceJobConfigID)
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", sourceJobConfigID)
				defer resp.Body.Close()

				Expect(getJobsResp.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", sourceJobConfigID)
				Expect(getJobsResp.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", sourceJobConfigID)
				Expect(getJobsResp.JobType).To(Equal("DISCOVER"), "Expected jobType to be DISCOVER for config %s", sourceJobConfigID)
			}

			Wait(100)

			By("Getting jobs by jobConfigId for source")
			discovery_validators := []string{
				"nfs_src_vol_discovery.json",
				"nfs_src_vol2_discovery.json",
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

				result, err := ValidateReport(sourceDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s", discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
				By(fmt.Sprintf("validate report result for %s: %s", sourceDiscoveryJobRunID, result))
			}

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
				Host:             DESTINATION_HOST_IP,
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

			By("Getting the destination file server by configId")
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", DESTINATION_VOLUMES[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a new discovery job for destination")

			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "",
				PreserveAccessTime:       false,
				FirstRunAt:               GetFutureUTCTimestamp(120),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			destinationJobConfigIDs, resp, err = CreateDiscoveryJob(destinationJobParams, headers)

			Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
			Expect(len(destinationJobConfigIDs)).To(BeNumerically(">", 0), "No valid destinationJobConfigIDs found in response")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

			Wait(10)
			By("Validating run not initiates on triggering Discovery if it is scheduled")
			for _, destinationJobConfigID := range destinationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(destinationJobConfigID, headers, false)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", destinationJobConfigID)
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", destinationJobConfigID)
				defer resp.Body.Close()

				Expect(getJobsResp.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", destinationJobConfigID)
				Expect(getJobsResp.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", destinationJobConfigID)
				Expect(getJobsResp.JobType).To(Equal("DISCOVER"), "Expected jobType to be DISCOVER for config %s", destinationJobConfigID)
			}

			Wait(100)

			By("Getting jobs by jobConfigId for destination")
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

			By("Creating a migration job")

			migrationParams := MigrationJobParams{
				FirstRunAt:         GetFutureUTCTimestamp(90),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
			Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "Expected at least one jobConfigID")
			Wait(10)

			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers, false)
				Expect(getJobsResp.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty")
				Expect(getJobsResp.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE")
				Expect(getJobsResp.JobType).To(Equal("MIGRATE"), "Expected jobType to be MIGRATE")
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			}

			Wait(80)

			migration_validators := []string{
				"nfs_src_to_dest_vol_migration.json",
				"nfs_src2_to_dest2_vol_migration.json",
			}
			// Wait for migration completion
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				result, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/%s", migration_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				By(fmt.Sprintf("validate report result : %s", result))
			}

			By("Adding Delta Data")
			err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			By("Creating bulk cutover job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")

			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
			Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
			Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")

			By("Getting jobs by job config id")
			for _, jobConfigID := range jobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID for config %s", jobConfigID)
				defer resp.Body.Close()

				cutoverRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(cutoverRunID).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", cutoverRunID)

				WaitForJobState(cutoverRunID, BLOCKED_JOBRUN, 30)
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

			By("Approving bulk cutover job")
			for _, cutoverRunID := range cutoverRunIDs {
				resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverRunID)
				defer resp.Body.Close()
			}

			// By("Validating cutover reports")
			// for _, cutoverRunID := range cutoverRunIDs {
			// 	result, err := ValidateReport(cutoverRunID, JobTypeCutover, "../../validators/cutover_validation.json")
			// 	Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
			// 	LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			// }
			By("########################## TC-003 end ################################")
		})

		AfterEach(func() {
			err := RemoveDeltaFromVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)

			err = RemoveDeltaFromVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath2)

			err = ClearVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)

			err = ClearVolume(destinationVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath2)

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			By("Cleanup complete.")
		})
	})
})
