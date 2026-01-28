package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// TC-SMB-REDIRECTS uses AD Server volumes (not cloneable)
var _ = Describe("TC-SMB-REDIRECTS: Test Redirect in SMB discovery", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB Redirects is skipped in CI/CD as it is not supported in NFS")
		}
	})
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		err                   error
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		adServerVolumes       []string
		adServerHostIPs       []string
		testStartTime         time.Time
	)

	Context("SMB Redirects Discovery Test", func() {
		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()

			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least 1 worker to be attached")
			workerIds := GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Get AD Server volumes (not cloneable)
			adServerVolumes, adServerHostIPs = GetADServerSMBVolumes()
			if len(adServerVolumes) == 0 {
				Skip("AD_SMB_SOURCE_VOLUMES not configured, skipping test")
			}
		})

		It("TC-SMB-REDIRECTS: Should discover redirects in SMB", func() {
			testStartTime = time.Now()
			By("########################## TC-SMB-REDIRECTS start ################################")
			LogDebug(fmt.Sprintf("[TC-SMB-REDIRECTS START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))

			var sourceConfigID, sourcePathID1 string
			var sourceJobConfigIDs []string

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating source SMB file server using AD Server volume")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-smb-redirects-%s-src-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             adServerHostIPs[0], // Use AD Server host
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source SMB file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting the source file server export path ID")
			sourcePathID1, err = GetExportPathID("source", adServerVolumes[0], sourceConfigID, headers) // Use AD Server volume
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
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)
			
			// Note: No volume cleanup needed
			// This test uses GetGlobalTestEnv() (shared workers/project) and AD Server volumes (not cloned)
			
			LogDebug(fmt.Sprintf("[TC-SMB-REDIRECTS END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-SMB-REDIRECTS DURATION] Total test duration: %s", testDuration))
		})
	})
})
