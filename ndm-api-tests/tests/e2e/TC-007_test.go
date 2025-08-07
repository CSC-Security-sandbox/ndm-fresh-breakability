package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/robfig/cron/v3"
)

var _ = Describe("TC-007: Run migration to multiple destinations with incremental sync schedule", func() {
	BeforeEach(func() {
		Skip("TC-007 is skipped in CI/CD due to flakyness")
	})
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
	Context("TC-007: Run migration to multiple destinations with incremental sync schedule", func() {

		BeforeEach(func() {
			numberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, SOURCE_VOLUMES[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, SOURCE_VOLUMES[1])

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, DESTINATION_VOLUMES[0])
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, DESTINATION_VOLUMES[1])
		})

		It("TC-007: Run migration to multiple destinations with incremental sync schedule", func() {
			By("########################## TC-007 start ################################")
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

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", SOURCE_VOLUMES[1], sourceConfigID, headers)
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
				Host:             DESTINATION_HOST_IP,
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

			By("Creating a migration job with Incremental Sync of 3 mins")
			currentDateTime := GetCurrentUTCTimestamp()
			migrationParams := MigrationJobParams{
				FirstRunAt:         currentDateTime,
				FutureRunSchedule:  "*/3 * * * *", // Cron expression of 3 mins
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
			Expect(len(migrationJobConfigIDs)).To(BeNumerically("==", 2), "Expected at least one jobConfigID")

			// Get migration job run IDs and wait for completion
			// migration_validators := []string{
			//     "nfs_src_to_dest_vol_migration.json",
			//     "nfs_src2_to_dest2_vol_migration.json",
			// }
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(len(getJobsResp.JobRuns)).To(BeNumerically("==", 1), "No jobRuns found in response")
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()

				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				// result, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/%s", migration_validators[i]))
				// Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				// By(fmt.Sprintf("validate report result : %s", result))
			}

			// Validating the NextScheduled time from response is within +-1 minutes and is 3 minutes later than 1st run
			parsedBase, err := time.Parse(TIME_FORMAT, currentDateTime)
			Expect(err).NotTo(HaveOccurred(), "Error parsing curreent datetimes")
			sch, err := cron.ParseStandard("*/3 * * * *")
			Expect(err).NotTo(HaveOccurred(), "invalid cron expression")
			expectedNext := sch.Next(parsedBase)

			for _, migrationJobConfigID := range migrationJobConfigIDs {
				jobSummary, err := GetJobSummaryByConfigID(ProjectId, migrationJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred())

				actualNext, err := time.Parse(TIME_FORMAT, jobSummary.NextScheduleDate)
				Expect(err).NotTo(HaveOccurred(),
					"could not parse NextScheduleDate %q", jobSummary.NextScheduleDate)

				// assert actualNext is within ±1min of expectedNext
				Expect(actualNext).To(BeTemporally("~", expectedNext, time.Second), "expected NextScheduleDate within 1 minute of %s; got %s",
					expectedNext.Format(TIME_FORMAT),
					jobSummary.NextScheduleDate)
			}

			By("Adding Delta Data for Incremental run")
			err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			Wait(180) // This delay is required to wait till new Job run created after 3 mins

			// Validating incremental Sync is getting triggered
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				Expect(len(getJobsResp.JobRuns)).To(BeNumerically("==", 2), "No jobRuns found in response")
				migrationJobRunID := getJobsResp.JobRuns[1].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()

				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				// Failing due to NDM-1708, need to uncomment after it's fix
				// result, err := ValidateReport(migrationJobRunID, JobTypeMigration, "../../validators/cutover_validation.json") // as adding delta data similar to cutover, hence using same validation json for incremental migration and cutover
				// Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				// By(fmt.Sprintf("validate report result : %s", result))
			}

			By("Remove Delta data from destinations")
			err = RemoveDeltaFromVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", destinationVolumePath1)
			err = RemoveDeltaFromVolume(destinationVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", destinationVolumePath2)

			By("Creating bulk cutover job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
			defer resp.Body.Close()

			Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
			Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")

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

			By("Validating cutover reports")
			for _, cutoverRunID := range cutoverRunIDs {
				result, err := ValidateReport(cutoverRunID, JobTypeCutover, ".././validators/cutover_validation.json")
				Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
				LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			}
			By("########################## TC-007 end ################################")
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
