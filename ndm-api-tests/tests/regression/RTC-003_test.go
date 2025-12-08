package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("RTC-003: Test discovery with single worker and restart the worker service during discovery for NFS", func() {
	var (
		ProjectId             string
		workerId              string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		headers               map[string]string
	)
	Context("RTC-003", func() {
		BeforeEach(func() {
			var ProjectName string
			NumberOfWorker := 1
			ProjectId, ProjectName, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			_ = ProjectName
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).To(Equal(1), "Expected one worker to be attached")
			workerIds = GetWorkerIds()
			workerId = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("RTC-003: Test discovery with single worker and restart the worker service during discovery for NFS", func() {
			By("########################## RTC-003 start ################################")

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
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}
			ConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(ConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			By(fmt.Sprintf("Source file server created with config ID: %#v", resp))

			By("Getting the source file server by config ID and fetching the volumes")
			volumeId, err := GetExportPathID("source", SOURCE_VOLUMES[0], ConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a new discovery job on the file server")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{volumeId},
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

			JobConfigId, resp, err := CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()

			getJobsResp, resp, err := GetJobRunDetails(JobConfigId[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			JobRunID := getJobsResp.JobRuns[0].JobRunId
			Expect(JobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

			By("Waiting for the discovery job to start running")
			err = WaitForJobState(JobRunID, RUNNING_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Discovery job did not start running successfully, err: %s", err))

			By("Make the worker go down by stopping the worker service")
			_, err = StopWorker(attachedWorkersConfig[workerId])
			Expect(err).NotTo(HaveOccurred(), "Error stopping worker service")

			By("Checking if discovery job is paused")
			err = WaitForJobState(JobRunID, PAUSED_JOBRUN, 60)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Discovery job did not pause successfully, err: %s", err))

			By("Bringing the worker back online by starting the worker service")
			_, err = StartWorker(attachedWorkersConfig[workerId])
			Expect(err).NotTo(HaveOccurred(), "Error starting worker service")

			By("Checking if discovery job is completed")
			err = WaitForJobState(JobRunID, COMPLETED_JOBRUN, 60)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Discovery job did not complete successfully, err: %s", err))
			By("########################## RTC-003 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started.")
			
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})

	})

})
