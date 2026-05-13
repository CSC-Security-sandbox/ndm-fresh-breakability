package tests

import (
	"encoding/base64"
	"fmt"
	. "ndm-api-tests/utils"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-005: Run migration with 'Upload GID/UID Mapping' option", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolSMB {
			Skip("TC-005: is skipped in CI/CD as it is not supported in SMB")
		}
	})
	var (
		ProjectId              string
		ProjectName            string
		workerId1              string
		workerId2              string
		workerIds              []string
		err                    error
		clonedSourceVolumes    []string
		clonedDestVolumes      []string
		sourceVolumePath1      string
		destinationVolumePath1 string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
		sourceGrpId            int
		destinationGrpId       int
		sourceUserId           int
		destinationUserId      int
		fileWithGroup          string
		csvData                string
		sourceVolumeManager    *TestVolumeManager
		destVolumeManager      *TestVolumeManager
		testStartTime          time.Time
	)

	Context("TC-005: Run migration with 'Upload GID/UID Mapping' option", func() {
		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Setup ONTAP volume cloning for parallel test execution
			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}

			// Guarantee cleanup even on manual interrupt (Ctrl+C)
			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})

			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], clonedDestVolumes[0])
			sourceGrpId = 1033
			destinationGrpId = 1034
			sourceUserId = 1001
			destinationUserId = 1002
			fileWithGroup = "sample.txt"
			csvPlain := strings.Join([]string{
				"gid_source,gid_target,uid_source,uid_target",
				"1033,1034,1001,1002",
				"0,0,0,0",
			}, "\n") + "\n"
			csvData = fmt.Sprintf(
				"data:text/csv;charset=utf-8;base64,%s",
				base64.StdEncoding.EncodeToString([]byte(csvPlain)),
			)

		})

		It("TC-005: Run migration with 'Upload GID/UID Mapping' option", func() {
			testStartTime = time.Now()
			By("########################## TC-005 start ################################")
			LogDebug(fmt.Sprintf("[TC-005 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))

			var sourceFileServerID, sourcePathID1, sourcePathID2 string
			var migrationJobConfigIDs []string
			var destinationFileServerID, destinationPathID1, destinationPathID2 string

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-005-%s-src-fs-%s", protocol, uniqueID),
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
			sourceFileServerID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceFileServerID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			By(fmt.Sprintf("Source file server created with config ID: %#v", resp))

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceFileServerID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceFileServerID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-005-%s-dest-fs-%s", protocol, uniqueID),
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
			destinationFileServerID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationFileServerID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server by configId")
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationFileServerID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationFileServerID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a migration job by uploading GID/UID mapping csv")
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
				ExtraParams: map[string]interface{}{
					"gidMapping": csvData,
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

			// Get migration job run IDs, wait for completion and validate the CoC migration report
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				result, err := ValidateReport(
					migrationJobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, migration_validators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				By(fmt.Sprintf("validate report result : %s", result))
			}

			By("Validate mapping correctly appears on source and destination as per csv")
			userId, groupId, err := GetFileUserGroupId(sourceVolumePath1, fileWithGroup)
			Expect(err).NotTo(HaveOccurred(), "error while GetFileUserGroupId at source")

			Expect(userId).To(Equal(sourceUserId), "fileUserId incorrect at source")
			Expect(groupId).To(Equal(sourceGrpId), "fileGroupId incorrect at source")

			userId, groupId, err = GetFileUserGroupId(destinationVolumePath1, fileWithGroup)
			Expect(err).NotTo(HaveOccurred(), "error while GetFileUserGroupId at destination")

			Expect(userId).To(Equal(destinationUserId), "fileuserId incorrect at destination")
			Expect(groupId).To(Equal(destinationGrpId), "fileGroupId incorrect at destination")

			By("########################## TC-005 end ################################")
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
			LogDebug(fmt.Sprintf("[TC-005 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-005 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})
