package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/robfig/cron/v3"
)

var _ = Describe("TC-009: Run migration with 'Exclude file older than' option and hourly incremental sync schedule", func() {
	var (
		ProjectId              string
		workerId1              string
		workerId2              string
		workerIds              []string
		err                    error
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
		sourceVolumePath1      string
		sourceVolumePath2      string
		destinationVolumePath1 string
		destinationVolumePath2 string
	)
	Context("TC-009: Run migration with 'Exclude file older than' option and hourly incremental sync schedule", func() {

		BeforeEach(func() {
			numberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME)
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME_1)

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME)
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME_1)
		})

		It("TC-009: Run migration with 'Exclude file older than' option and hourly incremental sync schedule", func() {
			By("########################## TC-009 start ################################")

			var (
				// Source-related IDs
				sourceConfigID               string
				sourcePathID1, sourcePathID2 string

				// Destination-related IDs
				destinationConfigID, destinationPathID1, destinationPathID2 string

				// Job Config and Migration IDs
				jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
			)
			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       "source-file-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         "Root",
				Password:         "",
				Protocol:         ProtocolNFS,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IP,
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", NFS_SOURCE_VOLUME_1, sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       "destination-file-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         "Root",
				Password:         "",
				Protocol:         ProtocolNFS,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IP,
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server by configId")
			destinationPathID1, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME_1, destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a migration job with Incremental Sync of 1 hr")
			currentDateTime := GetCurrentUTCTimestamp()
			migrationParams := MigrationJobParams{
				FirstRunAt:         currentDateTime,
				FutureRunSchedule:  "0 * * * *", // Cron expression of 1 hr
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeOlderThan":    "2024-06-30T16:37:00.000Z", // providing the hisotrical date before which some data is modified
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			// Get migration job run IDs and wait for completion
			migration_validators := []string{
				"nfs_src_to_dest_vol_migration.json",
				"nfs_src2_to_dest2_vol_migration.json",
			}
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(len(getJobsResp.JobRuns)).To(BeNumerically("==", 1), "No jobRuns found in response")
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()

				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				result, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/TC-009-JSON/%s", migration_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				By(fmt.Sprintf("validate report result : %s", result))
			}

			//Validating the NextScheduled TIme from response is next complete hour after 1st run
			parsedBase, err := time.Parse(TIME_FORMAT, currentDateTime)
			Expect(err).NotTo(HaveOccurred(), "parsing the timestamp from GetCurrentUTCTimestamp()")

			sched, err := cron.ParseStandard("0 * * * *")
			Expect(err).NotTo(HaveOccurred(), "parsing cron expression")
			nextHour := sched.Next(parsedBase)
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				jobSummary, err := GetJobSummaryByConfigID(ProjectId, migrationJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred())

				actualNext, err := time.Parse(TIME_FORMAT, jobSummary.NextScheduleDate)
				Expect(err).NotTo(HaveOccurred(),
					"could not parse NextScheduleDate %q", jobSummary.NextScheduleDate)

				Expect(actualNext).To(Equal(nextHour), "expected next schedule exactly at %s; got %s",
					nextHour.Format(TIME_FORMAT), jobSummary.NextScheduleDate,
				)
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
				defer resp.Body.Close()
			}

			// By("Validating cutover reports")
			// cutover_validators := []string{
			// 	"nfs_src_to_dest_vol_cutover.json",
			// 	"nfs_src2_to_dest2_vol_cutover.json",
			// }
			// for i, cutoverRunID := range cutoverRunIDs {
			// 	result, err := ValidateReport(cutoverRunID, JobTypeCutover, fmt.Sprintf("../../validators/TC-009-JSON/%s", cutover_validators[i]))
			// 	Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
			// 	By(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			// }
			By("########################## TC-009 end ################################")
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
