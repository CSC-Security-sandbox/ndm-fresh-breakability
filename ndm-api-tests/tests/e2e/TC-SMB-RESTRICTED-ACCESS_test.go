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

// TC-SMB-RESTRICTED-ACCESS uses AD Server volumes (not cloneable)
var _ = Describe("TC-SMB-RESTRICTED-ACCESS: Create a fileserver with a single worker and check discovery report", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB restricted access test is skipped as it is not supported in NFS")
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

	Context("TC-SMB-RESTRICTED-ACCESS", func() {
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
			if len(adServerVolumes) < 2 && len(adServerHostIPs) < 2 {
				Skip("AD_SMB_SOURCE_VOLUMES not configured or missing restricted volume (index 1), skipping test")
			}
		})

		It("TC-SMB-RESTRICTED-ACCESS: Create a fileserver with 1 worker and check discovery report", func() {
			testStartTime = time.Now()
			By("########################## TC-SMB-RESTRICTED-ACCESS start ################################")
			LogDebug(fmt.Sprintf("[TC-SMB-RESTRICTED-ACCESS START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))

			var sourceConfigID, sourcePathID1 string
			var sourceJobConfigIDs []string

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating source SMB file server using AD Server restricted volume")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-smb-restricted-%s-src-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             adServerHostIPs[1], // auto_smb_restrictedVol host (AD Server)
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting the Source File Server Export Path ID")
			sourcePathID1, err = GetExportPathID("source", adServerVolumes[1], sourceConfigID, headers) // auto_smb_restrictedVol
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			LogDebug(fmt.Sprintf("Source File Server Export Path ID : [%s]", sourcePathID1))

			By("Creating a Bulk Discovery Job for the Source File Server")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "*/.snapshot",
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

			result, err := ValidateReport(sourceDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", "SMB-PERMISSIONS", "tc_restricted_discovery.json"))
			Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
			LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job : %s = %s", sourceDiscoveryJobRunID, result))

			By("########################## TC-SMB-RESTRICTED-ACCESS end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)

			// Note: No volume cleanup needed
			// This test uses GetGlobalTestEnv() (shared workers/project) and AD Server volumes (not cloned)

			LogDebug(fmt.Sprintf("[TC-SMB-RESTRICTED-ACCESS END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-SMB-RESTRICTED-ACCESS DURATION] Total test duration: %s", testDuration))
		})
	})
})
