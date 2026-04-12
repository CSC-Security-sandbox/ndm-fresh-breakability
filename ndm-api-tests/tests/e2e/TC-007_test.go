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

var _ = FDescribe("TC-007: Edit discovery and migration job options and verify they take effect", func() {
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

	Context("TC-007: Edit discovery and migration job options and verify they take effect", func() {

		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			Expect(err).To(BeNil(), "Error setting up test volumes")

			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})

			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], clonedSourceVolumes[1])
		})

		It("TC-007: Edit discovery and migration job options and verify they take effect", func() {
			testStartTime = time.Now()
			By("########################## TC-007 start ################################")
			LogDebug(fmt.Sprintf("[TC-007 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))

			var (
				sourceConfigID                                     string
				sourcePathID1, sourcePathID2                       string
				destinationConfigID                                string
				destinationPathID1, destinationPathID2             string
				sourceDiscoveryJobConfigIDs, migrationJobConfigIDs []string
			)

			const (
				editExcludeOlderThan    = "2024-06-30T16:37:00.000Z"
				editExcludeFilePatterns = "*/folder_2/*, */symlink_2_to_jpg/*, */hardlink_2_to_pdf/*, /*.mp4/, /*.mp3/, /*.pdf/, /*.txt/, /*.csv/, /*.doc/, /*.text/, /*.jpg/, /*.json/, /*.png/"
				editSkipFile            = "15-M"
				// Jobs are parked 2 hours ahead at creation so the edit has a
				// guaranteed race-free window before the first run triggers.
				parkFirstRunAtOffset = 7200
				// After editing, firstRunAt is set 90 s ahead. Allow 150 s total
				// (90 s scheduled delay + 60 s buffer) before declaring no trigger.
				editFirstRunAtOffset = 90
				jobTriggerTimeout    = 150
			)

			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			// ------------------------------------------------------------------
			// Source file server
			// ------------------------------------------------------------------

			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-007-%s-src-fs-%s", protocol, uniqueID),
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
			Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting source file server export path IDs")
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error getting source export path: %s", err))

			sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error getting source export path: %s", err))

			// ------------------------------------------------------------------
			// Discovery: create (parked) → edit → wait for trigger → validate
			// ------------------------------------------------------------------

			By("Creating a Bulk Discovery Job parked 2 hours in the future (no filter options)")
			discoveryJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "",
				PreserveAccessTime:       false,
				FirstRunAt:               GetFutureUTCTimestamp(parkFirstRunAtOffset),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			sourceDiscoveryJobConfigIDs, resp, err = CreateDiscoveryJob(discoveryJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job: %v", err))
			defer resp.Body.Close()

			By("Editing discovery jobs: set ExcludePathPatterns, ExcludeFilesOlderThan and firstRunAt")
			for _, jobConfigID := range sourceDiscoveryJobConfigIDs {
				editParams := EditDiscoveryJobParams{
					ExcludeFilePatterns: editExcludeFilePatterns,
					ExcludeOlderThan:    editExcludeOlderThan,
					FirstRunAt:          GetFutureUTCTimestamp(editFirstRunAtOffset),
				}
				editResp, err := EditDiscoveryJob(jobConfigID, editParams, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error editing discovery job %s: %v", jobConfigID, err))
				Expect(editResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK editing discovery job %s", jobConfigID)
				defer editResp.Body.Close()
			}

			discovery_validators := []string{
				"src_vol_discovery.json",
				"src_vol2_discovery.json",
			}

			for i, jobConfigID := range sourceDiscoveryJobConfigIDs {
				By(fmt.Sprintf("Waiting for discovery job %s to reach READY state within %ds", jobConfigID, jobTriggerTimeout))
				jobRunID, err := WaitForJobToTrigger(jobConfigID, headers, jobTriggerTimeout/DefaultPollInterval)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Discovery job %s was not triggered within %ds", jobConfigID, jobTriggerTimeout))
				Expect(jobRunID).NotTo(BeEmpty(), "Discovery job run ID should not be empty")

				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Discovery job run %s did not complete", jobRunID))

				result, err := ValidateReport(
					jobRunID,
					JobTypeDiscovery,
					fmt.Sprintf("../../validators/TC-007-JSON/%s/%s", PROTOCOL_TYPE, discovery_validators[i]),
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating discovery report for run %s", jobRunID)
				LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job: %s = %s", jobRunID, result))
			}

			ModifyDataOnVolume(sourceVolumePath1)
			ModifyDataOnVolume(sourceVolumePath2)

			// ------------------------------------------------------------------
			// Destination file server
			// ------------------------------------------------------------------

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-007-%s-dest-fs-%s", protocol, uniqueID),
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
			Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting destination file server export path IDs")
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error getting destination export path: %s", err))

			destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error getting destination export path: %s", err))

			// ------------------------------------------------------------------
			// Migration: create (parked) → edit → wait for trigger → validate
			// ------------------------------------------------------------------

			By("Creating a migration job parked 2 hours in the future (no filter options)")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetFutureUTCTimestamp(parkFirstRunAtOffset),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "",
					"preserveAccessTime":  true,
					"preservePermissions": true,
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			By("Editing migration jobs: set ExcludePathPatterns, ExcludeFilesOlderThan, SkipFilesModifiedIn and firstRunAt")
			for _, jobConfigID := range migrationJobConfigIDs {
				editParams := EditMigrationJobParams{
					ExcludeFilePatterns: editExcludeFilePatterns,
					ExcludeOlderThan:    editExcludeOlderThan,
					SkipFile:            editSkipFile,
					FirstRunAt:          GetFutureUTCTimestamp(editFirstRunAtOffset),
				}
				editResp, err := EditMigrationJob(jobConfigID, editParams, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error editing migration job %s: %v", jobConfigID, err))
				Expect(editResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK editing migration job %s", jobConfigID)
				defer editResp.Body.Close()
			}

			migration_validators := []string{
				"src_to_dest_vol_migration.json",
				"src2_to_dest2_vol_migration.json",
			}

			var volumeReplacementMaps []map[string]string
			if PROTOCOL_TYPE == "NFS" {
				volumeReplacementMaps = []map[string]string{
					{
						"vol_dnd_src_automation_1":  clonedSourceVolumes[0],
						"vol_dnd_dest_automation_1": clonedDestVolumes[0],
					},
					{
						"vol_dnd_src_automation_2":  clonedSourceVolumes[1],
						"vol_dnd_dest_automation_2": clonedDestVolumes[1],
					},
				}
			} else { // SMB
				volumeReplacementMaps = []map[string]string{
					{
						"volSMBAuto_vol1": clonedSourceVolumes[0],
						"vol1":            clonedDestVolumes[0],
					},
					{
						"vol4_33": clonedSourceVolumes[1],
						"vol2":    clonedDestVolumes[1],
					},
				}
			}

			for i, jobConfigID := range migrationJobConfigIDs {
				By(fmt.Sprintf("Waiting for migration job %s to reach READY state within %ds", jobConfigID, jobTriggerTimeout))
				jobRunID, err := WaitForJobToTrigger(jobConfigID, headers, jobTriggerTimeout/DefaultPollInterval)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Migration job %s was not triggered within %ds", jobConfigID, jobTriggerTimeout))
				Expect(jobRunID).NotTo(BeEmpty(), "Migration job run ID should not be empty")

				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Migration job run %s did not complete", jobRunID))

				result, err := ValidateReport(
					jobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/TC-007-JSON/%s/%s", PROTOCOL_TYPE, migration_validators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating migration report for run %s", jobRunID)
				By(fmt.Sprintf("validate report result: %s", result))
			}

			By("########################## TC-007 end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)

			By("Cleanup started")
			err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}
			LogDebug("Cleanup complete.")
			LogDebug(fmt.Sprintf("[TC-007 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-007 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})
