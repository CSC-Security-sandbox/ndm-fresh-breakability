package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("RTC-005: Test migration with 2 worker and make worker unhealthy during migration for NFS", func() {
	var (
		ProjectId             string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		headers               map[string]string
	)
	Context("RTC-005", func() {
		BeforeEach(func() {
			NumberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).To(Equal(2), "Expected two workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("RTC-005: Test migration with 2 workers and make one worker unhealthy during migration for NFS", func() {
			By("########################## RTC-005 start ################################")

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
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			SourceConfigId, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(SourceConfigId).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
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
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}

			destinationConfigID, resp, err := CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

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

			By("Make one worker go down by stopping the worker service")
			_, err = StopWorker(attachedWorkersConfig[workerId1])
			Expect(err).NotTo(HaveOccurred(), "Error stopping worker service")

			//let the worker stay down for a while to simulate an unhealthy state
			Wait(60)

			By("Bringing the worker back online by starting the worker service")
			_, err = StartWorker(attachedWorkersConfig[workerId1])
			Expect(err).NotTo(HaveOccurred(), "Error starting worker service")

			By("Checking if Migration job is completed")
			err = WaitForJobState(JobRunID, COMPLETED_JOBRUN, 60)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Migration job did not complete successfully, err: %s", err))
			By("########################## RTC-005 end ################################")
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
