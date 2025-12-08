package tests

import (
	"fmt"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-004-005: Complete workflow with discovery, migration, and cutover - testing pause/resume/stop/adhoc-run at each stage", func() {
	var headers map[string]string
	var (
		ProjectId              string
		workerId1              string
		workerId2              string
		workerIds              []string
		err                    error
		attachedWorkersConfig  map[string]SSHConfig
		sourceVolumePath1      string
		sourceVolumePath2      string
		destinationVolumePath1 string
		destinationVolumePath2 string
	)
	Context("TC-004-005", func() {
		BeforeEach(func() {
			NumberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 1), "Expected at least one worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], SOURCE_VOLUMES[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], SOURCE_VOLUMES[1])
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[1], DESTINATION_VOLUMES[1])
		})

		It("TC-004-005: Complete workflow with discovery, migration, and cutover - testing pause/resume/stop/adhoc-run at each stage", func() {
			By("########################## TC-004-005 start ################################")
			var sourceConfigID1, sourceConfigID2, sourcePathID1, sourcePathID2 string
			var sourceJobConfigIDs, destinationJobConfigIDs, migrationJobConfigIDs, jobConfigIDs []string
			var destinationConfigID, destinationPathID1, destinationPathID2, destinationJobConfigID1, destinationJobConfigID2 string
			var migrationJobRunID string
			var list []string

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
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", DESTINATION_VOLUMES[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

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
			sourceConfigIDs := []string{sourceConfigID1, sourceConfigID2}
			sourceDiscoveryJobRunIDs := make([]string, len(sourceConfigIDs))
			discovery_validators := []string{
				"src_vol_discovery.json",
				"src_vol2_discovery.json",
			}
			for i, configID := range sourceConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(configID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				sourceDiscoveryJobRunIDs[i] = jobRunID
				Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("sourceDiscoveryJobRunID%d should not be empty", i+1))

				if i == 0 {

					list = nil
					list = append(list, jobRunID)

					err = HandleJobRunStateChange(jobRunID, "PAUSE", list)
					Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
					Wait(5)
					err = WaitForJobState(jobRunID, "PAUSED")
					Expect(err).NotTo(HaveOccurred(), "Job did not reach PAUSED state")
					Wait(5)
					err = HandleJobRunStateChange(jobRunID, "RESUME", list)
					Expect(err).NotTo(HaveOccurred(), "Error while resume job run ID")
					Wait(5)
					err = HandleJobRunStateChange(jobRunID, "STOP", list)
					Expect(err).NotTo(HaveOccurred(), "Error while stop job run ID")

					err = WaitForJobState(jobRunID, "STOPPED")
					Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
					//Adding wait to ensure temporal worker shut down completes after reaching STOPPED state
					Wait(60)
					_, _, err := TriggerAdHocJobRun(configID)
					Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")
					continue
				}
				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
				result, err := ValidateReport(jobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error while validate PDF report")
				By(fmt.Sprintf("validate report result : %s", result))
			}

			By("Creating a new discovery job for destination")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
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

			destinationJobConfigID1 = destinationJobConfigIDs[0]
			destinationJobConfigID2 = destinationJobConfigIDs[1]

			By("Getting jobs by jobConfigId for destination")
			destinationConfigIDs := []string{destinationJobConfigID1, destinationJobConfigID2}
			destinationDiscoveryJobRunIDs := make([]string, len(destinationConfigIDs))
			for i, configID := range destinationConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(configID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				destinationDiscoveryJobRunIDs[i] = jobRunID
				Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("destinationDiscoveryJobRunID%d should not be empty", i+1))
			}

			// Wait for both discovery jobs to complete
			for i, jobRunID := range destinationDiscoveryJobRunIDs {

				if i == 0 {
					err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Destination discovery job %d did not complete", i+1))
					continue
				}
				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Destination discovery job %d did not complete", i+1))
			}

			// ============== MIGRATION JOBS WITH STATE MANAGEMENT ==============
			By("STAGE 2: Creating migration jobs and testing pause/resume/stop/adhoc-run")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
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
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			migration_validators := []string{
				"src_to_dest_vol_migration.json",
				"src2_to_dest2_vol_migration.json",
			}

			// Get migration job run IDs and perform state management tests
			flag := false
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

				if !flag {
					list = nil
					list = append(list, migrationJobRunID)

					By(fmt.Sprintf("Testing PAUSE/RESUME/STOP/ADHOC on migration job %d", i+1))
					err = HandleJobRunStateChange(migrationJobRunID, "PAUSE", list)
					Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
					Wait(5)
					err = WaitForJobState(migrationJobRunID, "PAUSED")
					Expect(err).NotTo(HaveOccurred(), "Migration job did not reach PAUSED state")
					Wait(5)
					err = HandleJobRunStateChange(migrationJobRunID, "RESUME", list)
					Expect(err).NotTo(HaveOccurred(), "Error while resume job run ID")
					Wait(10)
					err = HandleJobRunStateChange(migrationJobRunID, "STOP", list)
					Expect(err).NotTo(HaveOccurred(), "Error while stop job run ID")
					flag = true
					Wait(10)
					err = WaitForJobState(migrationJobRunID, "STOPPED")
					Expect(err).NotTo(HaveOccurred(), "Job did not reach STOPPED state")
					Wait(60)
					adHocJobRunId, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
					Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")
					defer resp.Body.Close()
					err = WaitForJobState(adHocJobRunId, COMPLETED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), "Ad-hoc job did not complete")
					continue
				}

				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				result, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, migration_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error while validate migration report")
				By(fmt.Sprintf("validate migration report result : %s", result))
			}

			// ============== ADD DELTA DATA AND RUN CUTOVER ==============
			By("STAGE 3: Adding delta data for cutover")
			err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			By("Creating bulk cutover job and testing pause/resume/stop/adhoc-run")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			jobConfigIDsLoop := []string{jobConfigIDs[0], jobConfigIDs[1]}
			cutoverJobRunIDs := make([]string, len(jobConfigIDsLoop))
			for i, jobConfigID := range jobConfigIDsLoop {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting cutover job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				cutoverJobRunIDs[i] = jobRunID

				// Perform PAUSE, RESUME, and STOP operations on the first cutover job run
				if i == 0 {
					list = nil
					list = append(list, jobRunID)

					By(fmt.Sprintf("Testing PAUSE/RESUME/STOP/ADHOC on cutover job %d", i+1))
					err = HandleJobRunStateChange(jobRunID, "PAUSE", list)
					Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
					Wait(5)
					err = WaitForJobState(jobRunID, "PAUSED", 15)
					Expect(err).NotTo(HaveOccurred(), "Cutover job did not reach PAUSED state")
					Wait(5)
					err = HandleJobRunStateChange(jobRunID, "RESUME", list)
					Expect(err).NotTo(HaveOccurred(), "Error while resume job run ID")
					Wait(10)
					err = HandleJobRunStateChange(jobRunID, "STOP", list)
					Expect(err).NotTo(HaveOccurred(), "Error while stop job run ID")
					Wait(10)
					err = WaitForJobState(jobRunID, "STOPPED", 30)
					Expect(err).NotTo(HaveOccurred(), "Cutover job did not reach STOPPED state")
					Wait(60)
					adHocJobRunId, resp, err := TriggerAdHocJobRun(jobConfigID)
					Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")
					defer resp.Body.Close()
					err = WaitForJobState(adHocJobRunId, BLOCKED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), "Ad-hoc cutover job did not reach BLOCKED state")

					cutoverJobRunIDs[i] = adHocJobRunId
					continue
				}

				err = WaitForJobState(jobRunID, BLOCKED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Cutover job %d did not reach BLOCKED state", i+1))
			}

			By("Approving bulk cutover jobs")
			for i := 0; i < 2; i++ {
				resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunIDs[i], "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverJobRunIDs[i])
				defer resp.Body.Close()
			}

			By("########################## TC-004-005 end ################################")
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
