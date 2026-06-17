package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-002: Run discovery and migration with 'Exclude file older than', 'Exclude Path Patterns' and 'Skip files modified in last' options", func() {
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		sourceVolumePath1     string
		sourceVolumePath2     string
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
		testStartTime         time.Time
	)
	Context("TC-002: Run discovery and migration with 'Exclude file older than', 'Exclude Path Patterns' and 'Skip files modified in last' options", func() {

		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
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

		It("TC-002: Run discovery and migration with 'Exclude file older than', 'Exclude Path Patterns' and 'Skip files modified in last' options", func() {
			testStartTime = time.Now()
			By("########################## TC-002 start ################################")
			LogDebug(fmt.Sprintf("[TC-002 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))

			var (
				// Source-related IDs
				sourceConfigID               string
				sourcePathID1, sourcePathID2 string

				// Destination-related IDs
				destinationConfigID, destinationPathID1, destinationPathID2 string

				// Job Config and Migration IDs
				jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
			)
			
			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-002-%s-src-fs-%s", protocol, uniqueID),
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

			if NeedsGCNVManualUpload() {
				sourceConfigID, err = CreateSourceFileServerForGCNV(sourceParams, []string{clonedSourceVolumes[0], clonedSourceVolumes[1]}, headers)
				Expect(err).NotTo(HaveOccurred(), "Error creating GCNV source file server")
			} else {
				var resp *http.Response
				sourceConfigID, resp, err = CreateFileServer(sourceParams, headers)
				Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
				defer resp.Body.Close()
			}
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")

			By("Getting the source file server by config ID")
			if NeedsGCNVManualUpload() {
				sourcePathID1, err = GetSourcePathIDForGCNV(clonedSourceVolumes[0], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				sourcePathID2, err = GetSourcePathIDForGCNV(clonedSourceVolumes[1], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			} else {
				sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			}

			By("Creating a Bulk Discovery Job for the Source File Server")
			discoveryJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
				ExcludeOlderThan:         "2024-06-30T16:37:00.000Z",
				ExcludeFilePatterns:      "*/folder_2/*, */symlink_2_to_jpg/*, */hardlink_2_to_pdf/*, /*.mp4/, /*.mp3/, /*.pdf/, /*.txt/, /*.csv/, /*.doc/, /*.text/, /*.jpg/, /*.json/, /*.png/, */.snapshot",
				PreserveAccessTime:       false,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			sourceDiscoveryJobConfigIDs, resp, err := CreateDiscoveryJob(discoveryJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()

			discovery_validators := []string{
				"src_vol_discovery.json",
				"src_vol2_discovery.json",
			}

			var volumeReplacementMaps []map[string]string
			if PROTOCOL_TYPE == "NFS" {
				volumeReplacementMaps = []map[string]string{
					{
						"vol_dnd_src_automation_1": clonedSourceVolumes[0],
					},
					{
						"vol_dnd_src_automation_2": clonedSourceVolumes[1],
					},
				}
			} else { // SMB
				volumeReplacementMaps = []map[string]string{
					{
						"volSMBAuto_vol1": clonedSourceVolumes[0],
					},
					{
						"vol4_33": clonedSourceVolumes[1],
					},
				}
			}

			for i, sourceJobConfigID := range sourceDiscoveryJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()

				sourceDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

				// Wait for discovery jobs to complete
				err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", sourceDiscoveryJobRunID)

				result, err := ValidateReport(
					sourceDiscoveryJobRunID,
					JobTypeDiscovery,
					fmt.Sprintf("../../validators/TC-002-JSON/%s/%s", PROTOCOL_TYPE, discovery_validators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
				LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job : %s = %s", sourceDiscoveryJobRunID, result))
			}

			ModifyDataOnVolume(sourceVolumePath1)
			ModifyDataOnVolume(sourceVolumePath2)

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-002-%s-dest-fs-%s", protocol, uniqueID),
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

			if NeedsGCNVManualUpload() {
				destinationConfigID, err = CreateSourceFileServerForGCNV(destinationParams, []string{clonedDestVolumes[0], clonedDestVolumes[1]}, headers)
				Expect(err).NotTo(HaveOccurred(), "Error creating GCNV destination file server")
			} else {
				var resp *http.Response
				destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
				Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
				defer resp.Body.Close()
			}
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")

			By("Getting the destination file server by configId")
			if NeedsGCNVManualUpload() {
				destinationPathID1, err = GetSourcePathIDForGCNV(clonedDestVolumes[0], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				destinationPathID2, err = GetSourcePathIDForGCNV(clonedDestVolumes[1], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			} else {
				destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			}

			By("Creating a migration job")
			currentDateTime := GetCurrentUTCTimestamp()
			migrationParams := MigrationJobParams{
				FirstRunAt:         currentDateTime,
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeOlderThan":    "2024-06-30T16:37:00.000Z", // providing the hisotrical date before which some data is modified
					"excludeFilePatterns": "*/folder_2/*, */symlink_2_to_jpg/*, */hardlink_2_to_pdf/*, /*.mp4/, /*.mp3/, /*.pdf/, *.txt/, /*.csv/, /*.doc/, *.text/, /*.jpg/, /*.json/, /*.png/ ",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "15-M",
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			// Get migration job run IDs and wait for completion
			migration_validators := []string{
				"src_to_dest_vol_migration.json",
				"src2_to_dest2_vol_migration.json",
			}

			// Extend volume replacement maps for migration (source + destination volumes).
			if PROTOCOL_TYPE == "NFS" {
				volumeReplacementMaps[0]["vol_dnd_dest_automation_1"] = clonedDestVolumes[0]
				volumeReplacementMaps[1]["vol_dnd_dest_automation_2"] = clonedDestVolumes[1]
			} else { // SMB
				volumeReplacementMaps[0]["vol1"] = clonedDestVolumes[0]
				volumeReplacementMaps[1]["vol2"] = clonedDestVolumes[1]
			}

			// migrationCountBySourcePath maps SourceServer.Path -> baseline CoC file count so that
			// the cutover validation can look up the correct baseline by source path.
			migrationCountBySourcePath := make(map[string]int)

			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(len(getJobsResp.JobRuns)).To(BeNumerically("==", 1), "No jobRuns found in response")
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()

				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
				result, err := ValidateReport(
					migrationJobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/TC-002-JSON/%s/%s", PROTOCOL_TYPE, migration_validators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				By(fmt.Sprintf("validate report result : %s", result))

				// TC-002 uses excludeOlderThan + excludeFilePatterns so the effective file count
				// differs from the unfiltered baseline. Capture it dynamically and use it.
				baseCount, err := CountCocFileOnlyRows(migrationJobRunID)
				sourcePath := strings.TrimPrefix(getJobsResp.SourceServer.Path, "/")
				Expect(err).NotTo(HaveOccurred(), "Error counting baseline migration CoC rows for %s", sourcePath)
				migrationCountBySourcePath[sourcePath] = baseCount
				LogDebug(fmt.Sprintf("TC-002 baseline migration %s: %d rows in CoC report", sourcePath, baseCount))
			}

			By("Adding Delta Data")
			fmt.Println("Adding Delta Data to sourceVolumePath1")
			_, err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			fmt.Println("Adding Delta Data to sourceVolumePath2")
			_, err = AddDataToVolume(sourceVolumePath2)
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
			// cutoverRunBySourcePath maps SourceServer.Path -> cutoverRunID so the validation
			// loop can match each cutover run to its migration baseline by source path.
			cutoverRunBySourcePath := make(map[string]string)
			for _, jobConfigID := range jobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID for config %s", jobConfigID)
				defer resp.Body.Close()

				cutoverRunID := getJobsResp.JobRuns[0].JobRunId
				sourcePath := strings.TrimPrefix(getJobsResp.SourceServer.Path, "/")
				Expect(cutoverRunID).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", jobConfigID)

				WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)
				// Fetch the latest status
				getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")
				defer resp.Body.Close()

				Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found for config %s", jobConfigID)
				Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", jobConfigID)
				Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected status BLOCKED for config %s", jobConfigID)

				cutoverRunIDs = append(cutoverRunIDs, cutoverRunID)
				cutoverRunBySourcePath[sourcePath] = cutoverRunID
			}

			By("Approving bulk cutover job")
			for _, cutoverRunID := range cutoverRunIDs {
				resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
				defer resp.Body.Close()
			}

			// By("Validating cutover reports")
			By("Waiting for cutover jobs to complete and validating cutover reports")
			cutoverValidators := []string{
				"src_to_dest_vol_cutover.json",
				"src2_to_dest2_vol_cutover.json",
			}
			
			cutoverIndex := 0
			for sourcePath, cutoverRunID := range cutoverRunBySourcePath {
				err = WaitForJobState(cutoverRunID, APPROVED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Cutover job %s did not complete after approval", cutoverRunID)

				// Look up the baseline by source path, not by index, so ordering of API responses
				// across the migration and cutover calls cannot cause a cross-volume mismatch.
				expected := migrationCountBySourcePath[sourcePath]
				Expect(expected).NotTo(BeZero(), "No migration baseline found for source path %s — check SourceServer.Path consistency", sourcePath)
				By(fmt.Sprintf("Validating cutover CoC row count for %s: expected %d baseline rows", sourcePath, expected))
				cutoverRowCount, err := CountMigrationReportRows(cutoverRunID)
				Expect(err).NotTo(HaveOccurred(), "Error counting cutover CoC report rows for run %s", cutoverRunID)
				Expect(cutoverRowCount).To(Equal(expected),
					fmt.Sprintf("Cutover CoC for %s should have %d files (migration baseline) but got %d — possible full re-migration or delta-miss bug", sourcePath, expected, cutoverRowCount),
				)
				LogDebug(fmt.Sprintf("Cutover run %s (%s) correctly shows %d files in CoC report", cutoverRunID, sourcePath, cutoverRowCount))
				
				// Validate full cutover report structure
				// Find the volume index by checking which volume name is in the sourcePath
				volIndex := 0
				for i, vol := range clonedSourceVolumes {
					if strings.Contains(sourcePath, vol) {
						volIndex = i
						break
					}
				}
				result, err := ValidateReport(
					cutoverRunID,
					JobTypeCutover,
					fmt.Sprintf("../../validators/TC-002-JSON/%s/%s", PROTOCOL_TYPE, cutoverValidators[volIndex]),
					volumeReplacementMaps[volIndex],
				)
				Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
				By(fmt.Sprintf("Cutover validation result for %s: %s", sourcePath, result))
				cutoverIndex++
			}

			By("########################## TC-002 end ################################")
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
			LogDebug(fmt.Sprintf("[TC-002 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-002 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})
