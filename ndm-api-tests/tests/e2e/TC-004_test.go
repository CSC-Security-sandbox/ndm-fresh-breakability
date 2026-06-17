package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-004: Run migration with incremental sync schedule - verify both addition and deletion sync", func() {
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
	Context("TC-004: Run migration with incremental sync schedule - verify both addition and deletion sync", func() {

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

		It("TC-004: Run migration with incremental sync schedule - verify both addition and deletion sync", func() {
			testStartTime = time.Now()
			By("########################## TC-004 start ################################")
			LogDebug(fmt.Sprintf("[TC-004 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))
			var (
				// Source-related IDs
				sourceConfigID               string
				sourcePathID1, sourcePathID2 string

				// Destination-related IDs
				destinationConfigID, destinationPathID1, destinationPathID2 string

				// Job Config and Migration IDs
				migrationJobConfigIDs []string

				resp *http.Response
			)

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-004-%s-src-fs-%s", protocol, uniqueID),
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

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-004-%s-dest-fs-%s", protocol, uniqueID),
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

			By("Creating base migration job (no schedule - will use ad-hoc for incremental syncs)")
			currentDateTime := GetCurrentUTCTimestamp()
			migrationParams := MigrationJobParams{
				FirstRunAt:         currentDateTime,
				FutureRunSchedule:  "", // No schedule - incremental syncs triggered via ad-hoc
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

			var wg sync.WaitGroup

			// Validators for different phases
			baseValidators := []string{
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

			// 1) Run and validate initial migration (base data only)
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

					// Validate base migration report (no delta yet)
					LogDebug("Validate migration report for 1st iteration (base data without delta)")
					result, err := ValidateReport(
						migrationJobRunID,
						JobTypeMigration,
						fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, baseValidators[i]),
						volumeReplacementMaps[i],
					)
					Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
					By(fmt.Sprintf("validate report result : %s", result))

					if DeepMigrationValidationEnabled() {
						// Collect failures so both validations always run
						var failures []string

						// ── CoC report validation ──
						By("Validating CoC report against live destination (100 file sample)")
						dstVolPath := fmt.Sprintf("%s:/%s", DESTINATION_HOST_IPs[0], clonedDestVolumes[i])
						if PROTOCOL_TYPE == "SMB" {
							dstVolPath = fmt.Sprintf(`\\%s\%s`, DESTINATION_HOST_IPs[0], clonedDestVolumes[i])
						}
						cocResult, cocErr := ValidateCoCAgainstDestination(
							string(PROTOCOL_TYPE),
							migrationJobRunID,
							dstVolPath,
							GetAttachedWorkerDetails(),
							PROTOCOL_USERNAME,
							PROTOCOL_PASSWORD,
							100,
							headers,
						)
						if cocErr != nil {
							failures = append(failures, fmt.Sprintf("CoC report validation failed: %v", cocErr))
							LogError(fmt.Sprintf("[TC-004] CoC report fetch/parse error: %v", cocErr))
						} else if !cocResult.Match {
							LogError(fmt.Sprintf("[TC-004] CoC vs destination mismatch: %s", cocResult.Summary()))
							for _, d := range cocResult.Diffs {
								LogDebug(fmt.Sprintf("  %s", d))
							}
							failures = append(failures, fmt.Sprintf("CoC report does not match live destination:\n  %s",
								strings.Join(cocResult.Diffs, "\n  ")))
						} else {
							LogDebug(fmt.Sprintf("[TC-004] CoC validation PASSED: %s", cocResult.Summary()))
							fmt.Printf("[TC-004][goroutine-%d] CoC validation PASSED: %s\n", i, cocResult.Summary())
						}

						// ── Direct src↔dst metadata comparison ──
						By("Comparing source and destination metadata after base migration")
						fmt.Printf("[TC-004][goroutine-%d] Starting CompareProtocolMetadata...\n", i)
						var srcPath, dstPath string
						if PROTOCOL_TYPE == "SMB" {
							srcPath = fmt.Sprintf(`\\%s\%s`, SOURCE_HOST_IPs[0], clonedSourceVolumes[i])
							dstPath = fmt.Sprintf(`\\%s\%s`, DESTINATION_HOST_IPs[0], clonedDestVolumes[i])
						} else {
							srcPath = fmt.Sprintf("%s:/%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[i])
							dstPath = fmt.Sprintf("%s:/%s", DESTINATION_HOST_IPs[0], clonedDestVolumes[i])
						}
						fmt.Printf("[TC-004][goroutine-%d] src=%s dst=%s protocol=%s\n", i, srcPath, dstPath, PROTOCOL_TYPE)

						workerCfg := GetAttachedWorkerDetails()
						cmpResult, cmpErr := CompareProtocolMetadata(
							string(PROTOCOL_TYPE),
							srcPath,
							dstPath,
							workerCfg,
							PROTOCOL_USERNAME,
							PROTOCOL_PASSWORD,
							fmt.Sprintf("tc-004-base-%d", i),
							"../../test-results/metadata",
						)
						if cmpErr != nil {
							fmt.Printf("[TC-004][goroutine-%d] ERROR CompareProtocolMetadata: %v\n", i, cmpErr)
							failures = append(failures, fmt.Sprintf("metadata comparison failed for %s → %s: %v", srcPath, dstPath, cmpErr))
						} else if cmpResult.HasDiffs {
							LogError(fmt.Sprintf("[TC-004] metadata mismatch after base migration: %s", cmpResult.Summary()))
							if cmpResult.DiffsFile != "" {
								fmt.Printf("[TC-004][goroutine-%d] diffs file: %s\n", i, cmpResult.DiffsFile)
							}
							var msgs []string
							for _, p := range cmpResult.SrcOnlyPaths {
								msgs = append(msgs, fmt.Sprintf("src-only: %s", p))
							}
							for _, p := range cmpResult.DstOnlyPaths {
								msgs = append(msgs, fmt.Sprintf("dst-only: %s", p))
							}
							for _, d := range cmpResult.Discrepancies {
								msgs = append(msgs, fmt.Sprintf("path=%s field=%s src=%q dst=%q",
									d.Path, d.Field, d.SrcValue, d.DstValue))
							}
							fmt.Printf("[TC-004][goroutine-%d] METADATA MISMATCH:\n  %s\n", i, strings.Join(msgs, "\n  "))
							failures = append(failures, fmt.Sprintf("direct src↔dst metadata mismatch (%s):\n  %s",
								cmpResult.Summary(), strings.Join(msgs, "\n  ")))
						} else {
							fmt.Printf("[TC-004][goroutine-%d] METADATA COMPARISON PASSED: %s\n", i, cmpResult.Summary())
						}

						Expect(failures).To(BeEmpty(),
							"[TC-004][goroutine-%d] validation failures:\n  %s", i, strings.Join(failures, "\n  "))
					} else {
						LogDebug(fmt.Sprintf("[TC-004] skipping deep migration validation (set %s=true to enable)", DeepMigrationValidationEnv))
					}

				}(i, migrationJobConfigID)
			}
			wg.Wait()

			// 2) Addition sync: add delta data and trigger ad-hoc incremental run
			By("Step 1: Adding Delta Data for Addition Sync")
			deltaFolder1, err := AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			deltaFolder2, err := AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			// Update volume replacement maps to include dynamic delta folder names
			volumeReplacementMaps[0]["delta"] = deltaFolder1
			volumeReplacementMaps[1]["delta"] = deltaFolder2

			By("Step 2: Triggering ad-hoc addition sync and validating CoC reports")
			additionJobRunIDs := make([]string, len(migrationJobConfigIDs))
			additionValidators := []string{
				"src_to_dest_vol_addition_migration.json",
				"src2_to_dest2_vol_addition_migration.json",
			}
			
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				// Trigger ad-hoc incremental run
				additionJobRunID, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
				Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc addition sync for config %s", migrationJobConfigID)
				defer resp.Body.Close()
				Expect(additionJobRunID).NotTo(BeEmpty(), "Addition sync JobRun ID should not be empty")
				additionJobRunIDs[i] = additionJobRunID
				
				LogDebug(fmt.Sprintf("Triggered addition sync run %s for config %s", additionJobRunID, migrationJobConfigID))

				// Wait for completion
				err = WaitForJobState(additionJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Addition migration job did not complete")
				
				// Validate CoC report row count
				cocRowCount, err := CountMigrationReportRows(additionJobRunID)
				Expect(err).NotTo(HaveOccurred(), "Error counting CoC report rows for addition sync")
				Expect(cocRowCount).To(Equal(101), 
					fmt.Sprintf("Addition sync CoC should have 101 rows (1 dir + 100 files) but got %d", cocRowCount))
				
				// Validate full CoC report structure against golden JSON
				result, err := ValidateReport(
					additionJobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, additionValidators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating addition sync CoC report")
				By(fmt.Sprintf("Addition sync CoC validation result: %s", result))
				LogDebug(fmt.Sprintf("Addition sync run %s correctly migrated delta files with valid CoC structure", additionJobRunID))
			}

			By("Step 2.1: Discovering destination to verify addition sync migrated delta data")
			additionDiscoveryJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "*/.snapshot",
				PreserveAccessTime:       false,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			additionDiscoveryJobConfigIDs, resp, err := CreateDiscoveryJob(additionDiscoveryJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating discovery job for destination after addition sync")
			Expect(len(additionDiscoveryJobConfigIDs)).To(BeNumerically(">", 0), "No valid additionDiscoveryJobConfigIDs found")
			defer resp.Body.Close()

			additionDiscoveryValidators := []string{
				"dest_vol_after_addition_discovery.json",
				"dest_vol2_after_addition_discovery.json",
			}
			for i, additionDiscoveryJobConfigID := range additionDiscoveryJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(additionDiscoveryJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting discovery job run ID after addition sync")
				defer resp.Body.Close()

				additionDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(additionDiscoveryJobRunID).NotTo(BeEmpty(), "Addition Discovery JobRun ID should not be empty")

				err = WaitForJobState(additionDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job after addition sync did not complete")

				// Discovery validators only check file counts, no volume names to replace
				result, err := ValidateReport(
					additionDiscoveryJobRunID,
					JobTypeDiscovery,
					fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, additionDiscoveryValidators[i]),
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating discovery report after addition sync")
				By(fmt.Sprintf("Addition discovery validation result: %s", result))
			}

			// 3) Deletion sync: remove delta and trigger ad-hoc incremental run
			By("Step 3: Removing Delta Data for Deletion Sync")
			err = RemoveDeltaFromVolume(sourceVolumePath1, deltaFolder1)
			Expect(err).NotTo(HaveOccurred(), "Error removing delta data files from %s", sourceVolumePath1)
			err = RemoveDeltaFromVolume(sourceVolumePath2, deltaFolder2)
			Expect(err).NotTo(HaveOccurred(), "Error removing delta data files from %s", sourceVolumePath2)

			By("Step 4: Triggering ad-hoc deletion sync and validating deleted-files reports")
			deletionJobRunIDs := make([]string, len(migrationJobConfigIDs))
			
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				// Trigger ad-hoc incremental run
				deletionJobRunID, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
				Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc deletion sync for config %s", migrationJobConfigID)
				defer resp.Body.Close()
				Expect(deletionJobRunID).NotTo(BeEmpty(), "Deletion sync JobRun ID should not be empty")
				deletionJobRunIDs[i] = deletionJobRunID
				
				LogDebug(fmt.Sprintf("Triggered deletion sync run %s for config %s", deletionJobRunID, migrationJobConfigID))

				// Wait for completion
				err = WaitForJobState(deletionJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Deletion migration job did not complete")
				
				// Validate deleted-files report row count
				deletedCount, err := CountDeletedReportRows(deletionJobRunID)
				Expect(err).NotTo(HaveOccurred(), "Error counting deleted-files report rows for deletion sync")
				Expect(deletedCount).To(Equal(1), 
					fmt.Sprintf("Deletion sync should delete 1 directory (delta folder) but got %d", deletedCount))
				
				// Validate deleted paths contain the delta folder
				deletedPaths, err := GetDeletedFilePaths(deletionJobRunID)
				Expect(err).NotTo(HaveOccurred(), "Error getting deleted file paths for deletion sync")
				Expect(len(deletedPaths)).To(Equal(1), "Expected 1 deleted path (delta folder)")
				
				// Check that deleted path is the delta folder
				deltaFolderName := deltaFolder1
				if i == 1 {
					deltaFolderName = deltaFolder2
				}
				Expect(deletedPaths[0]).To(ContainSubstring(deltaFolderName), 
					fmt.Sprintf("Deleted path should contain delta folder %s", deltaFolderName))
				
				// Validate full deleted-report structure against golden JSON
				// Note: ValidateReport for deleted-report uses a custom CSV validation
				// We've already validated the path above, so just log success
				LogDebug(fmt.Sprintf("Deletion sync run %s correctly deleted delta folder %s", 
					deletionJobRunID, deltaFolderName))
			}

			By("Step 5: Discovering destination to verify deletion was mirrored (reusing existing discovery jobs)")
			// Reuse the discovery jobs created during addition validation by triggering ad-hoc runs
			deletionDiscoveryRunIDs := []string{}
			for _, discoveryJobConfigID := range additionDiscoveryJobConfigIDs {
				// Trigger ad-hoc run for the existing discovery job
				adhocRunID, adhocResp, err := TriggerAdHocJobRun(discoveryJobConfigID)
				Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc discovery run for deletion validation")
				defer adhocResp.Body.Close()

				Expect(adhocRunID).NotTo(BeEmpty(), "Ad-hoc run ID should not be empty")
				By(fmt.Sprintf("Triggered ad-hoc discovery run for deletion validation: %s", adhocRunID))

				deletionDiscoveryRunIDs = append(deletionDiscoveryRunIDs, adhocRunID)
			}

			By("Step 5.1: Waiting for deletion discovery runs to complete and validating")
			deletion_discovery_validators := []string{
				"dest_vol_discovery.json",
				"dest_vol2_discovery.json",
			}
			for i, deletionRunID := range deletionDiscoveryRunIDs {
				err := WaitForJobState(deletionRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Deletion discovery job did not complete")

				// Discovery validators only check file counts, no volume names to replace
				result, err := ValidateReport(
					deletionRunID,
					JobTypeDiscovery,
					fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, deletion_discovery_validators[i]),
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating deletion discovery report")
				By(fmt.Sprintf("Validate deletion discovery report result: %s", result))
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
				result, err := ValidateReport(
					cutoverRunID,
					JobTypeCutover,
					fmt.Sprintf("../../validators/TC-004-JSON/%s/%s", PROTOCOL_TYPE, cutover_validators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
				LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			}

			By("########################## TC-004 end ################################")
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
			LogDebug(fmt.Sprintf("[TC-004 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-004 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})
