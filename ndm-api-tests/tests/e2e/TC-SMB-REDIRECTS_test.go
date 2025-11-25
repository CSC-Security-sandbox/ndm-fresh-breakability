package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-SMB-REDIRECTS: Test Redirect in SMB discovery", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB Redirects is skipped in CI/CD as it is not supported in NFS")
		}
	})
	var (
		ProjectId             string
		workerId1             string
		err                   error
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
	)

	Context("SMB Redirects Discovery Test", func() {
		BeforeEach(func() {
			numberOfWorker := 1

			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)

			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
			workerIds := GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("TC-SMB-REDIRECTS: Should discover redirects in SMB", func() {
			By("########################## TC-SMB-REDIRECTS start ################################")

			var sourceConfigID, sourcePathID1 string
			var sourceJobConfigIDs []string

			By("Creating source SMB file server")
			sourceParams := CreateServereParams{
				ConfigName:       "source-smb-permissions-server",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[4],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source SMB file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting the source file server export path ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[4], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting source export path, err : %s", err))

			By("Creating a Bulk Discovery Job for the Source File Server")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "",
				PreserveAccessTime:       true,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()

			sourceJobConfigID := sourceJobConfigIDs[0]
			getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			sourceDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
			Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

			err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", sourceDiscoveryJobRunID)

			result, err := ValidateReport(sourceDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", "SMB", "redirects_validation.json"))
			Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
			LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job : %s = %s", sourceDiscoveryJobRunID, result))

			By("########################## TC-SMB-REDIRECTS end ################################")
		})

		AfterEach(func() {
			if PROTOCOL_TYPE == ProtocolNFS {
				LogDebug("Skipping cleanup as test was ")
				return
			}
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")
			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})
	})
})
