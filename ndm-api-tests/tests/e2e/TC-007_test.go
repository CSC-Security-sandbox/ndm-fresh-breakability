package tests

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	. "ndm-api-tests/utils"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// TC-007: Retry failed operations e2e.
// 1) Creates source/destination file servers (needed for workers + volume paths).
// 2) Seeds everything directly in DB: jobconfig, jobrun (FAILED), task, operations (ERRORED) + operation_errors (UNRESOLVED).
// 3) Triggers retry via POST /job-run/ad-hoc with jobRunId.
// 4) Waits for retry run to complete and asserts success.
//
// Requires: NDM_VM_* (CP SSH), KEYCLOAK_IP (OpenBao API), CP node with kubectl + Postgres access.
var _ = Describe("TC-007: Retry failed operations e2e", func() {
	var (
		ProjectId             string
		workerId1             string
		workerIds             []string
		err                   error
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
	)

	Context("TC-007", func() {
		BeforeEach(func() {
			var projectName string
			ProjectId, projectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			_ = projectName
			Expect(err).To(BeNil(), "Error getting global test environment")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least 1 worker")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}

			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})
		})

		It("TC-007: Seed operation_errors on CP then trigger retry and assert completion", func() {
			By("########################## TC-007 start ################################")
			if NDM_VM_HOST == "" || KEYCLOAK_IP == "" {
				Skip("NDM_VM_HOST and KEYCLOAK_IP required for retry test (CP SSH + OpenBao to get Postgres creds)")
			}

			var sourceConfigID, sourcePathID1 string
			var destinationConfigID, destinationPathID1 string
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating source file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-007-src-%s-%s", protocol, uniqueID),
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
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred())
			Expect(sourceConfigID).NotTo(BeEmpty())
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred())

			By("Creating destination file server")
			destParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-007-dest-%s-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destParams, headers)
			Expect(err).NotTo(HaveOccurred())
			Expect(destinationConfigID).NotTo(BeEmpty())
			defer resp.Body.Close()
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred())

			By("Loading retry fnames JSON")
			fnamesPath := "../../testdata/retry_fnames.json"
			if p := os.Getenv("RETRY_FNAMES_JSON"); p != "" {
				fnamesPath = p
			}
			retryInput, err := LoadRetryFnames(fnamesPath)
			Expect(err).NotTo(HaveOccurred(), "Load retry fnames from %s", fnamesPath)
			fnames := FnamesForProtocol(retryInput, protocol)
			Expect(len(fnames)).To(BeNumerically(">", 0), "retry_fnames.json must have entries for protocol %q", protocol)

			By("Seeding jobconfig + jobrun + operations + operation_errors directly in DB")
			seedResult, err := SeedRetryTestData(sourcePathID1, destinationPathID1, fnames, map[string]interface{}{
				"excludePatterns":    []string{},
				"preserveAccessTime": true,
				"skipFile":           "0",
				"isSMB":              protocol == "smb",
				"workerID":           workerId1,
			})
			Expect(err).NotTo(HaveOccurred(), "SeedRetryTestData failed")
			Expect(seedResult.JobConfigID).NotTo(BeEmpty())
			Expect(seedResult.JobRunID).NotTo(BeEmpty())
			LogDebug(fmt.Sprintf("Seeded: jobConfigID=%s jobRunID=%s", seedResult.JobConfigID, seedResult.JobRunID))

			By("Triggering retry run")
			retryRunID, resp, err := TriggerRetryRun(seedResult.JobConfigID, seedResult.JobRunID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(retryRunID).NotTo(BeEmpty())

			By("Waiting for retry run to complete")
			err = WaitForJobState(retryRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Retry run %s did not complete", retryRunID)

			By("Validating retry COC report against expected checksums")
			volumeReplacementMap := map[string]string{
				"vol_dnd_src_automation_1":  clonedSourceVolumes[0],
				"vol_dnd_dest_automation_1": clonedDestVolumes[0],
			}
			retryValidator := fmt.Sprintf("../../validators/%s/retry_migration.json", PROTOCOL_TYPE)
			result, err := ValidateReport(retryRunID, JobTypeMigration, retryValidator, volumeReplacementMap)
			Expect(err).NotTo(HaveOccurred(), "COC report validation failed for retry run %s", retryRunID)
			LogDebug(fmt.Sprintf("Retry COC report validation result: %s", result))

			By("########################## TC-007 end ################################")
		})
	})
})
