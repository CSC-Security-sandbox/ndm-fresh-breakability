package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-003: Complete workflow with discovery, migration, and cutover - testing pause/resume/stop/adhoc-run at each stage", func() {
	var headers map[string]string
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		sourceVolumePath1     string
		sourceVolumePath2     string
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
		testStartTime         time.Time
	)
	Context("TC-003", func() {
		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 1), "Expected at least one worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Setup test volumes (create clones for parallel test isolation)
			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			Expect(err).To(BeNil(), "Error setting up test volumes")

			// Guarantee cleanup even on manual interrupt (Ctrl+C)
			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})

			// Set volume paths using THIS test's cloned volumes
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], clonedSourceVolumes[1])
		})

		It("TC-003: Complete workflow with discovery, migration, and cutover - testing pause/resume/stop/adhoc-run at each stage", func() {
			testStartTime = time.Now()
			By("########################## TC-003 start ################################")
			LogDebug(fmt.Sprintf("[TC-003 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))
			var sourceConfigID1, sourceConfigID2, sourcePathID1, sourcePathID2 string
			var sourceJobConfigIDs, destinationJobConfigIDs, migrationJobConfigIDs, jobConfigIDs []string
			var destinationConfigID, destinationPathID1, destinationPathID2, destinationJobConfigID1, destinationJobConfigID2 string
			var migrationJobRunID string
			var list []string

			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating the source file server")
			// Adding a delay because sometimes the worker takes 10 to 15 seconds to attach
			Wait(20)
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-003-%s-src-fs-%s", protocol, uniqueID),
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
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-003-%s-dest-fs-%s", protocol, uniqueID),
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
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
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
					"preservePermissions": true,
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

			// Create volume replacement maps for dynamic validation
			// Map old hardcoded validator volume names to cloned volume names
			var volumeReplacementMaps []map[string]string
			if PROTOCOL_TYPE == "NFS" {
				volumeReplacementMaps = []map[string]string{
					{
						"vol_dnd_src_automation_1":  clonedSourceVolumes[0], // Old NFS source vol -> cloned name
						"vol_dnd_dest_automation_1": clonedDestVolumes[0],   // Old NFS dest vol -> cloned name
					},
					{
						"vol_dnd_src_automation_2":  clonedSourceVolumes[1], // Old NFS source vol -> cloned name
						"vol_dnd_dest_automation_2": clonedDestVolumes[1],   // Old NFS dest vol -> cloned name
					},
				}
			} else { // SMB
				volumeReplacementMaps = []map[string]string{
					{
						"volSMBAuto_vol1": clonedSourceVolumes[0], // Old SMB source vol -> cloned name
						"vol1":            clonedDestVolumes[0],   // Old SMB dest vol -> cloned name
					},
					{
						"vol4_33": clonedSourceVolumes[1], // Old SMB source vol -> cloned name
						"vol2":    clonedDestVolumes[1],   // Old SMB dest vol -> cloned name
					},
				}
			}

			// sourcePathToVolIndex maps each cloned source volume path to its vol index (0-based)
			// so validators and replacement maps are looked up by identity.
			sourcePathToVolIndex := make(map[string]int)
			for idx, vol := range clonedSourceVolumes {
				sourcePathToVolIndex[vol] = idx
			}

			flag := false
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

				sourcePath := strings.TrimPrefix(getJobsResp.SourceServer.Path, "/")
				volIndex, ok := sourcePathToVolIndex[sourcePath]
				Expect(ok).To(BeTrue(), "Could not map migration source path %q to any cloned volume", sourcePath)

				if !flag {
					list = nil
					list = append(list, migrationJobRunID)

					By(fmt.Sprintf("Testing PAUSE/RESUME/STOP/ADHOC on migration job for %s", sourcePath))
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

				result, err := ValidateReport(
					migrationJobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, migration_validators[volIndex]),
					volumeReplacementMaps[volIndex],
				)
				Expect(err).NotTo(HaveOccurred(), "Error while validate migration report")
				By(fmt.Sprintf("validate migration report result : %s", result))
			}

			// ============== ADD DELTA DATA AND RUN CUTOVER ==============
			By("STAGE 3: Adding delta data for cutover")
			_, err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			_, err = AddDataToVolume(sourceVolumePath2)
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
			// cutoverRunByVolIndex maps vol index -> cutoverRunID so the validation loop uses
			// BaselineCutoverFileCount(volIndex) matched by identity.
			cutoverRunByVolIndex := make(map[int]string)
			for i, jobConfigID := range jobConfigIDsLoop {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting cutover job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				cutoverJobRunIDs[i] = jobRunID

				sourcePath := strings.TrimPrefix(getJobsResp.SourceServer.Path, "/")
				volIndex, ok := sourcePathToVolIndex[sourcePath]
				Expect(ok).To(BeTrue(), "Could not map cutover source path %q to any cloned volume", sourcePath)

				// Perform PAUSE, RESUME, and STOP operations on the first cutover job run
				if i == 0 {
					list = nil
					list = append(list, jobRunID)

					By(fmt.Sprintf("Testing PAUSE/RESUME/STOP/ADHOC on cutover job for %s", sourcePath))
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
					cutoverRunByVolIndex[volIndex] = adHocJobRunId
					continue
				}

				err = WaitForJobState(jobRunID, BLOCKED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Cutover job %d did not reach BLOCKED state", i+1))
				cutoverRunByVolIndex[volIndex] = jobRunID
			}

			By("Approving bulk cutover jobs")
			for i := 0; i < 2; i++ {
				resp, err = ApproveRejectBulkCutoverJob(cutoverJobRunIDs[i], "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverJobRunIDs[i])
				defer resp.Body.Close()
			}

			By("Waiting for cutover jobs to complete and validating file counts")
			for volIndex, cutoverRunID := range cutoverRunByVolIndex {
				err = WaitForJobState(cutoverRunID, APPROVED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Cutover job %s did not complete after approval", cutoverRunID)

				// Use volIndex derived from SourceServer.Path so the correct baseline is applied
				// regardless of the order the cutover API returned the jobs.
				expected := BaselineCutoverFileCount(volIndex) + DeltaFilesInCutoverCoC
				By(fmt.Sprintf("Validating cutover CoC row count for vol%d: expected %d (baseline %d + %d delta files)", volIndex+1, expected, BaselineCutoverFileCount(volIndex), DeltaFilesInCutoverCoC))
				cutoverRowCount, err := CountMigrationReportRows(cutoverRunID)
				Expect(err).NotTo(HaveOccurred(), "Error counting cutover CoC report rows for run %s", cutoverRunID)
				Expect(cutoverRowCount).To(Equal(expected),
					fmt.Sprintf("Cutover CoC for vol%d should have %d files (baseline %d + %d delta) but got %d — possible full re-migration or delta-miss bug", volIndex+1, expected, BaselineCutoverFileCount(volIndex), DeltaFilesInCutoverCoC, cutoverRowCount),
				)
				LogDebug(fmt.Sprintf("Cutover run %s (vol%d) correctly shows %d files in CoC report", cutoverRunID, volIndex+1, cutoverRowCount))
			}

			By("########################## TC-003 end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)
			
			By("Cleanup started")
			// Note: This is redundant with DeferCleanup in BeforeEach, but provides defense in depth
			err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}
			LogDebug("Cleanup complete.")
			LogDebug(fmt.Sprintf("[TC-003 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-003 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})
