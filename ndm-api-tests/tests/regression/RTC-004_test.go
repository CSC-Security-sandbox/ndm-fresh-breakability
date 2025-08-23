package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("RTC-004: Test migration with single worker and make worker unhealthy during migration for NFS", func() {
	var (
		ProjectId             string
		workerId              string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		headers               map[string]string
	)
	Context("RTC-004", func() {
		BeforeEach(func() {
			NumberOfWorker := 1
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).To(Equal(1), "Expected one worker to be attached")
			workerIds = GetWorkerIds()
			workerId = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("RTC-004: Test migration with single worker and make worker unhealthy during migration for NFS", func() {
			By("########################## RTC-004 start ################################")

			By("Creating the source file server")
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
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}
			SourceConfigId, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(SourceConfigId).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			By(fmt.Sprintf("Source file server created with config ID: %#v", resp))

			By("Getting the source file server by config ID and fetching the volumes")
			sourceVolumeId, err := GetExportPathID("source", NFS_SOURCE_VOLUME, SourceConfigId, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

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
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}

			destinationConfigID, resp, err := CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting the destination file server by configId")
			destinationVolumeID, err := GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a migration job")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourceVolumeId},
				DestinationPathIDs: []string{destinationVolumeID},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "15-M",
				},
			}

			migrationJobConfigID, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			JobRunID := getJobsResp.JobRuns[0].JobRunId
			Expect(JobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

			By("Waiting for the migration job to start running")
			err = WaitForJobState(JobRunID, RUNNING_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Migration job did not start running successfully, err: %s", err))

			By("Make the worker go down by stopping the worker service")
			_, err = StopWorker(attachedWorkersConfig[workerId])
			Expect(err).NotTo(HaveOccurred(), "Error stopping worker service")

			By("Checking if Migration job is paused")
			err = WaitForJobState(JobRunID, PAUSED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Migration job did not pause successfully, err: %s", err))

			By("Bringing the worker back online by starting the worker service")
			_, err = StartWorker(attachedWorkersConfig[workerId])
			Expect(err).NotTo(HaveOccurred(), "Error starting worker service")

			By("Checking if Migration job is completed")
			err = WaitForJobState(JobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Migration job did not complete successfully, err: %s", err))

			By("########################## RTC-004 end ################################")

		})

		AfterEach(func() {
			err := ClearVolume(fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME))
			Expect(err).To(BeNil(), "Error during clearing destination volume")
			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			By("Cleanup complete.")
		})

	})

})
