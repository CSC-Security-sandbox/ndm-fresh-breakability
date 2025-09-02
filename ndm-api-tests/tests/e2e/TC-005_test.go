package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-005: Running migration / cutover with an exclude path pattern and batch pause/resume/stop/adhoc-run", func() {
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
	Context("TC-005", func() {
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

		It("TC-005 : Running migration / cutover with an exclude path pattern and batch pause/resume/stop/adhoc-run", func() {
			By("########################## TC-005 start ################################")
			var sourceConfigID1, sourcePathID1, sourcePathID2 string
			var jobConfigIDs, migrationJobConfigIDs []string
			var migrationJobRunID string
			var destinationConfigID, destinationPathID1, destinationPathID2 string
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

			By("Creating a migration job")
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
			// Get migration job run IDs and wait for completion
			flag := false
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

				if !flag {
					list = nil
					list = append(list, migrationJobRunID)

					err = HandleJobRunStateChange(migrationJobRunID, "PAUSE", list)
					Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
					Wait(1)
					err = HandleJobRunStateChange(migrationJobRunID, "RESUME", list)
					Expect(err).NotTo(HaveOccurred(), "Error while resume job run ID")
					Wait(1)
					err = HandleJobRunStateChange(migrationJobRunID, "STOP", list)
					Expect(err).NotTo(HaveOccurred(), "Error while stop job run ID")
					flag = true

					err = WaitForJobState(migrationJobRunID, "STOPPED", 30)
					Expect(err).NotTo(HaveOccurred(), "Job did not reach STOPPED state")
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
				Expect(err).NotTo(HaveOccurred(), "Error while validate COC report")
				By(fmt.Sprintf("validate COC report result : %s", result))
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
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			jobConfigIDsLoop := []string{jobConfigIDs[0], jobConfigIDs[1]}
			cutoverJobRunIDs := make([]string, len(jobConfigIDsLoop))
			for i, jobConfigID := range jobConfigIDsLoop {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				cutoverJobRunIDs[i] = jobRunID

				//  Perform PAUSE, RESUME, and STOP operations on the first cutover job run
				if i == 0 {
					list = nil
					list = append(list, jobRunID)

					err = HandleJobRunStateChange(jobRunID, "PAUSE", list)
					Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
					Wait(1)
					err = HandleJobRunStateChange(jobRunID, "RESUME", list)
					Expect(err).NotTo(HaveOccurred(), "Error while resume job run ID")
					Wait(1)
					err = HandleJobRunStateChange(jobRunID, "STOP", list)
					Expect(err).NotTo(HaveOccurred(), "Error while stop job run ID")
					err = WaitForJobState(jobRunID, "STOPPED", 30)
					Expect(err).NotTo(HaveOccurred(), "Cutover job did not complete")
					adHocJobRunId, resp, err := TriggerAdHocJobRun(jobConfigID)
					Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")
					defer resp.Body.Close()
					err = WaitForJobState(adHocJobRunId, BLOCKED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), "Ad-hoc job did not complete")

					cutoverJobRunIDs[i] = adHocJobRunId
					continue
				}

				WaitForJobState(jobRunID, BLOCKED_JOBRUN)

				getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Cutover%d job did not reach BLOCKED state", i+1))
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
				Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
				Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")
			}

			// result, err := ValidateReport(cutoverJobRunIDs[1], JobTypeCutover, fmt.Sprintf("../../validators/%s/COCDetails.json", PROTOCOL_TYPE))
			// Expect(err).NotTo(HaveOccurred(), "Error while validate COC report")
			// LogDebug(fmt.Sprintf("validate COC report result : %s", result))

			By("Approving bulk cutover job")

			for i := 0; i < 2; i++ {
				resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunIDs[i], "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job for run %s", cutoverJobRunIDs[i])
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverJobRunIDs[i])
				resp.Body.Close()
			}
			By("########################## TC-005 end ################################")
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
