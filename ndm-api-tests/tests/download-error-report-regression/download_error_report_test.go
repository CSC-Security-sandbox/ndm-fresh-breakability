package downloaderrorreportregression

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Download Error Report", Ordered, func() {
	var (
		ProjectId               string
		workerId1               string
		workerIds               []string
		headers                 map[string]string
		attachedWorkersConfig   map[string]SSHConfig
		sourceJobConfigID       []string
		SourceConfigID          string
		sourcePathID1           string
		sourceDiscoveryJobRunID string
	)

	BeforeAll(func() {
		var err error
		numberOfWorker := 1
		ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
		workerIds = GetWorkerIds()
		workerId1 = workerIds[0]
		headers = GetHeaders(AuthToken, ContentTypeJSON)

	})

	AfterAll(func() {
		LogDebug("Cleaning up test environment")
		cleanUpErr := CleanupTestEnv()
		Expect(cleanUpErr).To(BeNil(), "Error during test environment cleanup")
	})

	Context("Test Data Setup", func() {
		It("Should create file server and generate errored jobs", func() {
			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       "source_manual_upload_01",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         "Root",
				Password:         "",
				Protocol:         ProtocolNFS,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IP,
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}

			var err error
			var resp *http.Response
			SourceConfigID, resp, err = CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(SourceConfigID).NotTo(BeEmpty(), "SourceConfigID is empty")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			Wait(10)

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", NFS_SOURCE_VOLUME, SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			fmt.Println("Source Path ID:", sourcePathID1)

			By("Creating a new discovery job for the source")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1},
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
			sourceJobConfigID, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating new discovery for source: %v", err))
			defer resp.Body.Close()

			By("Getting job run details and waiting for error state")
			getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			sourceDiscoveryJobRunID = getJobsResp.JobRuns[0].JobRunId
			Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

			By("Bringing the worker back online by restarting the worker service")
			_, err = RestartWorker(attachedWorkersConfig[workerId1])
			Expect(err).NotTo(HaveOccurred(), "Error restarting worker service")
			Wait(15)

			By("Waiting for job to reach error state")
			err = WaitForJobState(sourceDiscoveryJobRunID, ERRORED_JOBRUN)
			Expect(err).To(HaveOccurred(), "Discovery job %s did not complete", sourceDiscoveryJobRunID)

			fmt.Printf("Test data setup complete - JobConfigID: %s, JobRunID: %s\n", sourceJobConfigID[0], sourceDiscoveryJobRunID)
		})
	})

	Context("CSV Generation Tests", func() {
		It("TC-001: Should generate CSV for job-run ID", func() {
			fmt.Println("Generating CSV for job-run ID:", sourceDiscoveryJobRunID)
			csvResponse, err := GenerateCsvFile("job-run", sourceDiscoveryJobRunID, headers)
			Expect(err).To(BeNil(), "Generate CSV should succeed")
			Expect(csvResponse).To(ContainSubstring("CSV generation started"), "Should receive CSV generation started message from backend")
		})

		It("TC-002: Should generate CSV for job-config ID", func() {
			csvResponse, err := GenerateCsvFile("job-config", sourceJobConfigID[0], headers)
			Expect(err).To(BeNil(), "Generate CSV should succeed")
			Expect(csvResponse).To(ContainSubstring("CSV generation started"), "Should receive CSV generation started message from backend")
		})
	})

	Context("CSV Readiness Polling Tests", func() {
		It("TC-003: Should poll CSV readiness for job-run ID", func() {
			ready, _, err := PollForCsvReadiness("job-run", sourceDiscoveryJobRunID, headers, 10, 2*time.Second)
			Expect(err).To(BeNil(), "Polling for CSV readiness should succeed")
			Expect(ready).To(BeTrue(), "CSV should be ready after polling")
		})

		It("TC-004: Should poll CSV readiness for job-config ID", func() {
			ready, _, err := PollForCsvReadiness("job-config", sourceJobConfigID[0], headers, 10, 2*time.Second)
			Expect(err).To(BeNil(), "Polling for CSV readiness should succeed")
			Expect(ready).To(BeTrue(), "CSV should be ready after polling")
		})
	})

	Context("CSV Download Tests", func() {
		It("TC-005: Should download CSV for job-run ID", func() {
			statusCode, err := DownloadErrorCsv("job-run", sourceDiscoveryJobRunID, headers)
			Expect(err).To(BeNil(), "Download CSV should succeed")
			Expect(statusCode).To(Equal(http.StatusOK), "Should get 200 response for download")
		})

		It("TC-006: Should download CSV for job-config ID", func() {
			statusCode, err := DownloadErrorCsv("job-config", sourceJobConfigID[0], headers)
			Expect(err).To(BeNil(), "Download CSV should succeed")
			Expect(statusCode).To(Equal(http.StatusOK), "Should get 200 response for download")
		})
	})
})
