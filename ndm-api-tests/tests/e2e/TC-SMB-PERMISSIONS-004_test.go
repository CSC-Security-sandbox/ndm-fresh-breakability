package tests

import (
	"fmt"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-SMB-PERMISSIONS-004: Test SMB inheritance preservation during migration", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB inheritance testing is skipped in CI/CD as it is not supported in NFS")
		}
	})

	var (
		ProjectId              string
		workerId1              string
		err                    error
		destinationVolumePath1 string
		sourceVolumePath1      string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
	)

	Context("SMB Inheritance Flags Migration Test", func() {
		BeforeEach(func() {
			numberOfWorker := 1

			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)

			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
			workerIds := GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[2], DESTINATION_VOLUMES[2])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[3], SOURCE_VOLUMES[3])
		})

		It("TC-SMB-PERMISSIONS-004: Should preserve inheritance flags during SMB migration", func() {
			By("########################## TC-SMB-PERMISSIONS-004 start ################################")
			var sourceConfigID, sourcePathID1 string
			var destinationConfigID, destinationPathID1 string
			var migrationJobConfigIDs []string

			By("Creating source SMB file server")
			sourceParams := CreateServereParams{
				ConfigName:       "source-smb-inheritance-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[3],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source SMB file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting the source file server export path ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[3], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting source export path, err : %s", err))

			By("Creating comprehensive inheritance test structure on source SMB volume")
			err = CreateSMBFilesWithInheritanceScenarios(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating inheritance test structure on source volume %s", sourceVolumePath1))

			By("Waiting for inheritance test structure to be created")
			Wait(15)

			By("Recording inheritance permissions from source volume")
			sourceInheritancePermissions, err := GetSMBPermissionsWithInheritanceDetails(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error getting inheritance permissions from source volume %s", sourceVolumePath1))
			Expect(len(sourceInheritancePermissions)).To(BeNumerically(">", 0), "No inheritance permissions were recorded from source volume")
			LogDebug(fmt.Sprintf("Captured %d files/directories with inheritance permissions", len(sourceInheritancePermissions)))

			By("Logging inheritance scenarios found in source")
			LogInheritanceScenarioSummary(sourceInheritancePermissions)

			By("Creating destination SMB file server")
			destinationParams := CreateServereParams{
				ConfigName:       "destination-smb-inheritance-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[2],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating destination SMB file server")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server export path ID")
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[2], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting destination export path, err : %s", err))

			By("Creating a migration job to migrate inheritance permissions")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         true,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}

			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "No migration job config IDs returned")
			defer resp.Body.Close()

			migrationJobConfigID := migrationJobConfigIDs[0]

			By("Waiting for migration job to complete")
			getMigrationJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run details")
			Expect(len(getMigrationJobsResp.JobRuns)).To(BeNumerically("==", 1), "No jobRuns found in response")
			defer resp.Body.Close()

			migrationJobRunID := getMigrationJobsResp.JobRuns[0].JobRunId
			Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete successfully")

			By("Waiting for files to settle on destination")
			Wait(15)

			By("Recording inheritance permissions from destination volume")
			destinationInheritancePermissions, err := GetSMBPermissionsWithInheritanceDetails(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error getting inheritance permissions from destination volume %s", destinationVolumePath1))
			Expect(len(destinationInheritancePermissions)).To(BeNumerically(">", 0), "No inheritance permissions were recorded from destination volume")
			LogDebug(fmt.Sprintf("Captured %d files/directories with inheritance permissions from destination", len(destinationInheritancePermissions)))

			By("Validating inheritance flag preservation")
			err = CompareSMBPermissionsWithInheritanceValidation(sourceInheritancePermissions, destinationInheritancePermissions)
			Expect(err).To(BeNil(), "SMB permissions with inheritance were not properly preserved during migration: %v", err)

			LogDebug("Expected inheritance scenarios validated")

			By("########################## TC-SMB-PERMISSIONS-004 complete ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")

			err = ClearVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error clearing source volume %s", sourceVolumePath1))

			err = ClearVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error clearing destination volume %s", destinationVolumePath1))

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})
	})
})
