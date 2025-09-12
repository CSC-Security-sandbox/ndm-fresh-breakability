package tests

import (
	"fmt"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-011: Run migration with 'Upload GID/UID Mapping' option", func() {
	BeforeEach(func() {
		Skip("TC-011 test case skipped")
	})
	var (
		ProjectId              string
		workerId1              string
		workerId2              string
		workerIds              []string
		err                    error
		sourceVolumePath1      string
		destinationVolumePath1 string
		destinationVolumePath2 string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
		sourceGrpId            int
		destinationGrpId       int
		sourceUserId           int
		destinationUserId      int
		fileWithGroup          string
		csvData                string
	)

	Context("TC-011: Run migration with 'Upload GID/UID Mapping' option", func() {
		BeforeEach(func() {
			numberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker, "TC-11-ABCDEF")
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], SOURCE_VOLUMES[0])
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
			destinationVolumePath2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[1], DESTINATION_VOLUMES[1])
			sourceGrpId = 1033
			destinationGrpId = 1034
			sourceUserId = 1001
			destinationUserId = 1002
			fileWithGroup = "sample.txt"
			// Base64 encoded CSV data for sourceGrpId=1033, destinationGrpId=1034, sourceUserId=1001, destinationUserId=1002
			csvData =
				"data:text/csv;charset=utf-8;base64,Z2lkX3NvdXJjZSxnaWRfdGFyZ2V0LHVpZF9zb3VyY2UsdWlkX3RhcmdldA0KMTAzMywxMDM0LDEwMDEsMTAwMg0K"

		})

		It("TC-011: Run migration with 'Upload GID/UID Mapping' option", func() {
			By("########################## TC-011 start ################################")

			var sourceFileServerID, sourcePathID1, sourcePathID2 string
			var migrationJobConfigIDs []string
			var destinationFileServerID, destinationPathID1, destinationPathID2 string

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
			sourceFileServerID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceFileServerID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			By(fmt.Sprintf("Source file server created with config ID: %#v", resp))

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[0], sourceFileServerID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", SOURCE_VOLUMES[1], sourceFileServerID, headers)
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
			destinationFileServerID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationFileServerID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server by configId")
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationFileServerID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", DESTINATION_VOLUMES[1], destinationFileServerID, headers)
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
					"skipFile":            "0-M",
				},
				ExtraParams: map[string]interface{}{
					"gidMapping": csvData,
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			// migration_validators := []string{
			// 	"src_to_dest_vol_migration.json",
			// 	"src2_to_dest2_vol_migration.json",
			// }
			// Get migration job run IDs, wait for completion and validate the CoC migration report
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				// result, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, migration_validators[i]))
				// Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				// By(fmt.Sprintf("validate report result : %s", result))
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

			By("########################## TC-011 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")
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
