package downloaderrorreporte2e

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"os"
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

		reportServiceURL := os.Getenv("REPORT_SERVICE_URL")
		fmt.Printf("🔍 [DEBUG] REPORT_SERVICE_URL = '%s'\n", reportServiceURL)
		if reportServiceURL == "" {
			fmt.Println("⚠️  WARNING: REPORT_SERVICE_URL is not set! This may cause JSON parsing errors.")
		}

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
			UserName:         PROTOCOL_USERNAME,
			Password:         PROTOCOL_PASSWORD,
			Protocol:         PROTOCOL_TYPE,
			ProtocolVersion:  ProtocolVersion3,
			Host:             SOURCE_HOST_IPs[0],
			Workers:          []string{workerId1},
			WorkingDirectory: "",
		}

		var err error
		var resp *http.Response
		if NeedsGCNVManualUpload() {
			SourceConfigID, err = CreateSourceFileServerForGCNV(sourceParams, []string{SOURCE_VOLUMES[0]}, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating GCNV source file server")
		} else {
			SourceConfigID, resp, err = CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
		}
		Expect(SourceConfigID).NotTo(BeEmpty(), "SourceConfigID is empty")
		Wait(10)

		By("Getting the source file server by config ID")
		if NeedsGCNVManualUpload() {
			sourcePathID1, err = GetSourcePathIDForGCNV(SOURCE_VOLUMES[0], SourceConfigID, headers)
		} else {
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[0], SourceConfigID, headers)
		}
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
		fmt.Println("Source Path ID:", sourcePathID1)

			By("Creating a new discovery job for the source")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1},
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
			sourceJobConfigID, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
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

	Context("End-to-End CSV Flow Tests for jobRunId", func() {
		It("TC-007: Should complete full CSV flow for job-run ID", func() {
			By("Step 1: Generate CSV")
			fmt.Printf("🔍 [DEBUG] Testing with valid job run ID: %s\n", sourceDiscoveryJobRunID)
			csvResponse, err := GenerateCsvFile("job-run", sourceDiscoveryJobRunID, headers)
			Expect(err).To(BeNil(), "Generate CSV should succeed")
			Expect(csvResponse).To(ContainSubstring("CSV generation started"), "Should receive CSV generation started message from backend")

			By("Step 2: Poll for readiness")
			ready, _, err := PollForCsvReadiness("job-run", sourceDiscoveryJobRunID, headers, 10, 2*time.Second)
			Expect(err).To(BeNil(), "Polling for CSV readiness should succeed")
			Expect(ready).To(BeTrue(), "CSV should be ready after polling")

			By("Step 3: Download CSV")
			DownloadErrorCsvStatusCode, err := DownloadErrorCsv("job-run", sourceDiscoveryJobRunID, headers)
			Expect(err).To(BeNil(), "Download CSV should succeed")
			Expect(DownloadErrorCsvStatusCode).To(Equal(http.StatusOK), "Should get 200 response for download")

		})

	})

	Context("End-to-End CSV Flow Tests for JobConfigId", func() {
		It("TC-008: Should complete full CSV flow for job-config ID", func() {
			By("Step 1: Generate CSV")
			csvResponse, err := GenerateCsvFile("job-config", sourceJobConfigID[0], headers)
			Expect(err).To(BeNil(), "Generate CSV should succeed")
			Expect(csvResponse).To(ContainSubstring("CSV generation started"), "Should receive CSV generation started message from backend")

			By("Step 2: Poll for readiness")
			ready, _, err := PollForCsvReadiness("job-config", sourceJobConfigID[0], headers, 10, 2*time.Second)
			Expect(err).To(BeNil(), "Polling should succeed")
			Expect(ready).To(BeTrue(), "CSV should be ready")

			By("Step 3: Download CSV")
			statusCode, err := DownloadErrorCsv("job-config", sourceJobConfigID[0], headers)
			Expect(err).To(BeNil(), "Download should succeed")
			Expect(statusCode).To(Equal(http.StatusOK), "Should get 200 response")
		})
	})

	Context("Error Handling Tests", func() {

		It("TC-009: Should handle invalid job-run ID gracefully", func() {
			invalidJobRunID := "undefined"
			_, err := GenerateCsvFile("job-run", invalidJobRunID, headers)
			Expect(err).NotTo(BeNil(), "Should return error for invalid job-run ID")
		})

		It("TC-010: Should handle invalid job-config ID gracefully", func() {
			invalidJobConfigID := "undefined"
			_, err := GenerateCsvFile("job-config", invalidJobConfigID, headers)
			Expect(err).NotTo(BeNil(), "Should return error for invalid job-config ID")
		})

		It("TC-011: Should handle download for non-existent CSV", func() {
			nonExistentJobRunID := "123e4567-e89b-12d3-a456-426614174000"
			statusCode, err := DownloadErrorCsv("job-run", nonExistentJobRunID, headers)
			Expect(err).NotTo(BeNil(), "Should return error for non-existent CSV")
			Expect(statusCode).NotTo(Equal(http.StatusOK), "Should not return 200 for non-existent CSV")
		})

	})

})
