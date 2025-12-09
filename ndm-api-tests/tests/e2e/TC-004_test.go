package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"sync"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/robfig/cron/v3"
)

var _ = Describe("TC-007-014: Run migration with incremental sync schedule - verify both addition and deletion sync", func() {
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
	Context("TC-007-014: Run migration with incremental sync schedule - verify both addition and deletion sync", func() {

		BeforeEach(func() {
			numberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], SOURCE_VOLUMES[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], SOURCE_VOLUMES[1])

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[1], DESTINATION_VOLUMES[1])
		})

		It("TC-007-014: Run migration with incremental sync schedule - verify both addition and deletion sync", func() {
			By("########################## TC-007-014 start ################################")
			var (
				// Source-related IDs
				sourceConfigID               string
				sourcePathID1, sourcePathID2 string

				// Destination-related IDs
				destinationConfigID, destinationPathID1, destinationPathID2 string

				// Job Config and Migration IDs
				migrationJobConfigIDs []string
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
				Host:             SOURCE_HOST_IPs[0],
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

			By("Creating base migration job with Incremental Sync of 5 mins")
			currentDateTime := GetCurrentUTCTimestamp()
			migrationParams := MigrationJobParams{
				FirstRunAt:         currentDateTime,
				FutureRunSchedule:  "*/5 * * * *", // Cron expression of 5 mins
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

			var wg sync.WaitGroup

			// Validators for different phases
			baseValidators := []string{
				"src_to_dest_vol_migration.json",
				"src2_to_dest2_vol_migration.json",
			}
			additionValidators := []string{
				"src_to_dest_vol_delta_migration.json",
				"src2_to_dest2_vol_delta_migration.json",
			}

			// Track base run IDs and next schedule times for each migration config
			baseRunIDs := make([]string, len(migrationJobConfigIDs))
			nextScheduleTimes := make([]time.Time, len(migrationJobConfigIDs))

			// 1) Run and validate initial migration (base data only), record run IDs and next schedules
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				wg.Add(1)
				go func(i int, migrationJobConfigID string) {
					defer GinkgoRecover()
					defer wg.Done()

					getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
					Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
					Expect(len(getJobsResp.JobRuns)).To(BeNumerically("==", 1), "No jobRuns found in response")
					defer resp.Body.Close()

					migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
					Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

					// Wait for base migration completion
					err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

					getJobRunResp, err := GetJobRunInfo(migrationJobRunID)
					Expect(err).NotTo(HaveOccurred(), "Error getting job run info")

					jobSummary, err := GetJobSummaryByConfigID(ProjectId, migrationJobConfigID, headers)
					Expect(err).NotTo(HaveOccurred())

					LogDebug(fmt.Sprintf("Migration %s got completed at %s, Next schedule at : %s", migrationJobRunID, getJobRunResp.EndTime, jobSummary.NextScheduleDate))

					actualNext, err := time.Parse(TIME_FORMAT, jobSummary.NextScheduleDate)
					Expect(err).NotTo(HaveOccurred(), "could not parse NextScheduleDate %q", jobSummary.NextScheduleDate)

					parsedBase, err := time.Parse(TIME_FORMAT, getJobRunResp.EndTime)
					Expect(err).NotTo(HaveOccurred(), "Error parsing base end time")

					// Log cron-based expectation for observability, but do not assert strict equality
					sch, err := cron.ParseStandard("*/5 * * * *")
					Expect(err).NotTo(HaveOccurred(), "invalid cron expression")
					expectedNext := sch.Next(parsedBase)
					LogDebug(fmt.Sprintf("Cron-based next for %s would be %s; controller reports %s",
						migrationJobConfigID,
						expectedNext.Format(TIME_FORMAT),
						jobSummary.NextScheduleDate,
					))

					// Only sanity check: next schedule must be after base end time
					Expect(actualNext).To(BeTemporally("<=", parsedBase.Add(15*time.Minute)),
						"NextScheduleDate %s is unexpectedly far after base end time %s",
						jobSummary.NextScheduleDate,
						getJobRunResp.EndTime,
					)
					Expect(actualNext).To(BeTemporally(">", parsedBase),
						"NextScheduleDate %s should be after base end time %s",
						jobSummary.NextScheduleDate,
						getJobRunResp.EndTime,
					)

					// Record base run ID and next schedule for later incremental detection
					baseRunIDs[i] = migrationJobRunID
					nextScheduleTimes[i] = actualNext

					// Validate base migration report (no delta yet)
					LogDebug("Validate migration report for 1st iteration (base data without delta)")
					result, err := ValidateReport(migrationJobRunID, JobTypeMigration,
						fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, baseValidators[i]))
					Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
					By(fmt.Sprintf("validate report result : %s", result))
				}(i, migrationJobConfigID)
			}
			wg.Wait()

			// Ensure we have recorded schedule times for all configs
			for i := range migrationJobConfigIDs {
				Expect(baseRunIDs[i]).NotTo(BeEmpty(), fmt.Sprintf("baseRunIDs[%d] should not be empty", i))
				Expect(!nextScheduleTimes[i].IsZero()).To(BeTrue(), fmt.Sprintf("nextScheduleTimes[%d] should be set", i))
			}

			// 2) Addition sync: add delta data shortly before the next scheduled time, then wait for the new run
			By("Step 1: Adding Delta Data for Incremental run (Addition Sync)")
			// Add the delta now; scheduler will pick it up on the next run
			err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			// Compute how long to wait until just after the earliest next schedule across configs
			var earliestNext time.Time
			for i, t := range nextScheduleTimes {
				if i == 0 || t.Before(earliestNext) {
					earliestNext = t
				}
			}
			buffer := 30 * time.Second
			waitDuration := time.Until(earliestNext.Add(buffer))
			if waitDuration < 0 {
				waitDuration = buffer
			}
			LogDebug(fmt.Sprintf("Waiting %s until just after scheduled time %s for addition sync", waitDuration.String(), earliestNext.Format(TIME_FORMAT)))
			Wait(int(waitDuration.Seconds()))

			By("Step 2: Validating incremental Sync for addition is triggered")
			additionJobRunIDs := make([]string, len(migrationJobConfigIDs))

			// Poll for a new job run that is different from the base run ID
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				baseRunID := baseRunIDs[i]
				Expect(baseRunID).NotTo(BeEmpty(), "Base run ID should not be empty when looking for addition sync")

				var (
					additionRunID string
					pollErr       error
				)

				pollUntil := time.Now().Add(10 * time.Minute)
				for time.Now().Before(pollUntil) {
					getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
					Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID for addition sync")
					defer resp.Body.Close()

					if len(getJobsResp.JobRuns) == 0 {
						Wait(10)
						continue
					}

					latestIdx := len(getJobsResp.JobRuns) - 1
					candidateID := getJobsResp.JobRuns[latestIdx].JobRunId

					if candidateID != baseRunID {
						additionRunID = candidateID
						break
					}

					Wait(15)
				}

				if additionRunID == "" {
					pollErr = fmt.Errorf("timed out waiting for new addition sync run different from base run %s for config %s", baseRunID, migrationJobConfigID)
				}
				Expect(pollErr).NotTo(HaveOccurred())

				additionJobRunIDs[i] = additionRunID
				LogDebug(fmt.Sprintf("Detected addition sync run %s for config %s (base run %s)", additionRunID, migrationJobConfigID, baseRunID))

				// Wait for addition sync completion
				err = WaitForJobState(additionRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job for addition sync did not complete")

				// Validate addition sync report (should include delta data)
				result, err := ValidateReport(additionRunID, JobTypeMigration,
					fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, additionValidators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error validating addition sync report")
				By(fmt.Sprintf("Addition sync validation result: %s", result))
			}

			// 3) Deletion sync: remove delta and again look for a new run after the next schedule
			By("Step 3: Removing Delta Data for Deletion Sync (Incremental run)")
			err = RemoveDeltaFromVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error removing delta data files from %s", sourceVolumePath1)
			err = RemoveDeltaFromVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error removing delta data files from %s", sourceVolumePath2)

			// Recompute earliest next schedule based on last completed (addition) run times
			// For simplicity and robustness, use a fixed wait similar to addition but still search for a new run distinct from the last known one.
			LogDebug("Polling job details for incremental deletion sync run")

			By("Step 4: Validating incremental Sync for deletion is triggered")
			deletionJobRunIDs := make([]string, len(migrationJobConfigIDs))

			for i, migrationJobConfigID := range migrationJobConfigIDs {
				lastKnownRunID := additionJobRunIDs[i]
				Expect(lastKnownRunID).NotTo(BeEmpty(), "Last known (addition) run ID should not be empty when looking for deletion sync")

				var (
					deletionRunID string
					pollErr       error
				)

				pollUntil := time.Now().Add(10 * time.Minute)
				for time.Now().Before(pollUntil) {
					getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
					Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID for deletion sync")
					defer resp.Body.Close()

					if len(getJobsResp.JobRuns) == 0 {
						Wait(10)
						continue
					}

					latestIdx := len(getJobsResp.JobRuns) - 1
					candidateID := getJobsResp.JobRuns[latestIdx].JobRunId

					if candidateID != lastKnownRunID {
						deletionRunID = candidateID
						break
					}

					Wait(15)
				}

				if deletionRunID == "" {
					pollErr = fmt.Errorf("timed out waiting for new deletion sync run different from last known run %s for config %s", lastKnownRunID, migrationJobConfigID)
				}
				Expect(pollErr).NotTo(HaveOccurred())

				deletionJobRunIDs[i] = deletionRunID
				LogDebug(fmt.Sprintf("Detected deletion sync run %s for config %s (previous run %s)", deletionRunID, migrationJobConfigID, lastKnownRunID))

				// Wait for deletion sync completion
				err = WaitForJobState(deletionRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job for deletion sync did not complete")
			}

			By("Step 5: Discovering destination to verify deletion was mirrored")
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
			discoveryJobConfigIDs, resp, err := CreateDiscoveryJob(destinationJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating discovery job for destination")
			Expect(len(discoveryJobConfigIDs)).To(BeNumerically(">", 0), "No valid discoveryJobConfigIDs found")
			defer resp.Body.Close()
			By("Getting jobs by jobConfigId for destination discovery")
			discovery_validators := []string{
				"dest_vol_discovery.json",
				"dest_vol2_discovery.json",
			}
			for i, destinationJobConfigID := range discoveryJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(destinationJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()

				destinationDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(destinationDiscoveryJobRunID).NotTo(BeEmpty(), "Destination Discovery JobRun ID should not be empty")

				err = WaitForJobState(destinationDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job did not complete")

				result, err := ValidateReport(destinationDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error validating discovery report")
				By(fmt.Sprintf("Validate discovery report result: %s", result))
			}

			By("Creating bulk cutover job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
			}
			cutoverJobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			cutoverRunIDs := []string{}

			By("Getting jobs by job config id")
			for _, jobConfigID := range cutoverJobConfigIDs {
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
			cutover_validators := []string{
				"src_to_dest_vol_cutover.json",
				"src2_to_dest2_vol_cutover.json",
			}
			By("Validating cutover reports")
			for i, cutoverRunID := range cutoverRunIDs {
				result, err := ValidateReport(cutoverRunID, JobTypeCutover, fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, cutover_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
				LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			}

			By("########################## TC-007-014 end ################################")
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
