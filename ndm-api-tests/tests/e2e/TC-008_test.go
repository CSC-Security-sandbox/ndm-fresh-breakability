package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-008: Run migration with 'Skip files modified in last' option", func() {
	var headers map[string]string
	var (
		ProjectId             string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		sourcePathId1         string
		sourcePathId2         string
		destinationPathId1    string
		destinationPathId2    string
	)
	BeforeEach(func() {
		NumberOfWorker := 2
		ProjectId, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 1), "Expected at least one worker to be attached")
		workerIds = GetWorkerIds()
		workerId1 = workerIds[0]
		workerId2 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		sourcePathId1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME)
		sourcePathId2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME_1)

		destinationPathId1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME)
		destinationPathId2 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME_1)
	})

	It("TC-008: Run migration with 'Skip files modified in last' option", func() {
		var (
			// Source-related IDs
			sourceConfigID1              string
			sourcePathID1, sourcePathID2 string

			// Destination-related IDs
			destinationConfigID, destinationPathID, destinationPathID1 string

			// Job Config and Migration IDs
			migrationJobConfigIDs []string
			migrationJobRunID     string
		)
		By("Creating the source file server")
		// Adding a delay because sometimes the worker takes 10 to 15 seconds to attach
		Wait(20)
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
		sourceConfigID1, resp, err := CreateFileServer(sourceParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
		Expect(sourceConfigID1).NotTo(BeEmpty(), "sourceConfigID1 is empty")
		defer resp.Body.Close()

		By("Getting the source file server by config ID")
		sourcePathID1, err = GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

		sourcePathID2, err = GetExportPathID("source", NFS_SOURCE_VOLUME_1, sourceConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

		ModifyDataOnVolume(sourcePathId1)
		ModifyDataOnVolume(sourcePathId2)
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
		destinationPathID, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

		destinationPathID1, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME_1, destinationConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

		By("Creating a migration job")
		migrationParams := MigrationJobParams{
			FirstRunAt:         GetCurrentUTCTimestamp(),
			FutureRunSchedule:  "",
			SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
			DestinationPathIDs: []string{destinationPathID, destinationPathID1},
			SidMapping:         false,
			Options: map[string]interface{}{
				"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
				"preserveAccessTime":  true,
				"skipFile":            "15-M",
			},
		}
		migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
		Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "Expected at least one jobConfigID")

		// Get migration job run IDs and wait for completion
		validationPath := TC_008_VALIDATION_JSON
		for i, migrationJobConfigID := range migrationJobConfigIDs {
			getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
			migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

			response, err := ValidateReport(migrationJobRunID, JobTypeMigration, fmt.Sprintf("../validators/TC-008-JSON/%s", validationPath[i]))
			Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
			LogDebug(fmt.Sprintf("Report validation response: %v", response))
		}

	})

	AfterEach(func() {
		RestoreOriginalDataOnVolume(sourcePathId1)
		RestoreOriginalDataOnVolume(sourcePathId2)
		ClearVolume(destinationPathId1)
		ClearVolume(destinationPathId2)

		err := CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		LogDebug("Cleanup complete.")
	})
})
