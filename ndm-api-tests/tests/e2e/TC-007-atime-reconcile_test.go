package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// TC-007 — Access-time reconcile across the full job lifecycle.
//
// Goal: prove that the new STAMP_ATIME op correctly propagates source access
// time onto the destination during migration, incremental migration, and
// cutover, but NOT during discovery, for files, directories, and symlinks on
// both NFS and SMB.
//
// The spec is parametric on PROTOCOL_TYPE (driven by `--protocol_type` flag
// in `e2e_suite_test.go`) so the same file exercises both protocols via the
// existing run-{nfs,smb}-azure-automation.sh scripts.
//
// Layout per iteration:
//   - Build source/destination file servers and discover path IDs (TC-003 pattern).
//   - Seed source with one file, one directory, one symlink at known atimes.
//   - Replicate the same tree on the destination at a DIFFERENT atime so the
//     scan branch sees only atimeMs drift and emits STAMP_ATIME commands.
//   - Run each phase and assert atime convergence via `atime_manager.go`.
var _ = Describe("TC-007: Access-time reconcile across migration/incremental/cutover for files, directories, and symlinks", func() {
	var headers map[string]string
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
	)

	Context("TC-007", func() {
		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[TC-007 BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least one worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			Expect(err).To(BeNil(), "Error setting up test volumes")

			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})
		})

		It("TC-007: STAMP_ATIME propagates source atime to destination across all job phases except discovery", func() {
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			// ---- 1. File servers + path IDs (TC-003 layout, single-volume scope) ----
			By("Creating the source file server")
			Wait(20)
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-007-%s-src-fs-%s", protocol, uniqueID),
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
			Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID empty")
			defer resp.Body.Close()

			sourcePathID, err := GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting source export path ID")

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-007-%s-dst-fs-%s", protocol, uniqueID),
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
			destinationConfigID, resp, err := CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID empty")
			defer resp.Body.Close()

			destinationPathID, err := GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting destination export path ID")

			// ---- 2. Seed test tree on source AND destination at distinct atimes ----
			// The destination tree is pre-seeded (instead of relying on migration to
			// create it) so the scan branch sees a destination that already exists,
			// content+meta align, and only `atimeMs` differs — the precondition for
			// STAMP_ATIME emission.
			sourceAtime := time.Date(2024, 7, 15, 12, 34, 56, 0, time.UTC)
			destAtime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

			srcRoot, dstRoot := buildTestRootPaths(clonedSourceVolumes[0], clonedDestVolumes[0])
			srcFile := joinShare(srcRoot, "file.txt")
			srcDir := joinShare(srcRoot, "subdir")
			srcLink := joinShare(srcRoot, "link.lnk")
			dstFile := joinShare(dstRoot, "file.txt")
			dstDir := joinShare(dstRoot, "subdir")
			dstLink := joinShare(dstRoot, "link.lnk")

			By("Seeding source tree (file, directory, symlink) with source atime")
			Expect(SeedAtimeFixture(srcRoot, srcFile, srcDir, srcLink, sourceAtime)).
				To(Succeed(), "seed source fixture failed")
			Expect(SetSourceAtime(srcFile, sourceAtime)).To(Succeed())
			Expect(SetSourceAtime(srcDir, sourceAtime)).To(Succeed())
			Expect(SetSourceAtime(srcLink, sourceAtime)).To(Succeed())

			By("Seeding destination tree with mismatched atime")
			Expect(SeedAtimeFixture(dstRoot, dstFile, dstDir, dstLink, destAtime)).
				To(Succeed(), "seed destination fixture failed")
			Expect(SetSourceAtime(dstFile, destAtime)).To(Succeed())
			Expect(SetSourceAtime(dstDir, destAtime)).To(Succeed())
			Expect(SetSourceAtime(dstLink, destAtime)).To(Succeed())

			// ---- 3. Discovery (negative — destination atime must NOT change) ----
			By("Phase: Discovery — destination atime MUST remain untouched")
			discParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID},
				PreserveAccessTime:       false,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			discoveryConfigIDs, resp, err := CreateDiscoveryJob(discParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating discovery job")
			defer resp.Body.Close()
			Expect(discoveryConfigIDs).NotTo(BeEmpty())

			discRun, resp, err := GetJobRunDetails(discoveryConfigIDs[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting discovery job run")
			defer resp.Body.Close()
			Expect(WaitForJobState(discRun.JobRuns[0].JobRunId, COMPLETED_JOBRUN)).
				To(Succeed(), "Discovery job did not complete")

			Expect(ExpectAtimeUnchanged(dstFile, destAtime)).To(Succeed(), "discovery moved dest file atime (R2 violated)")
			Expect(ExpectAtimeUnchanged(dstDir, destAtime)).To(Succeed(), "discovery moved dest dir atime (R2 violated)")
			Expect(ExpectAtimeUnchanged(dstLink, destAtime)).To(Succeed(), "discovery moved dest symlink atime (R2 violated)")

			// ---- 4. Migration with preserveAccessTime=false (R5 negative side) ----
			By("Phase: Migration with preserveAccessTime=false — destination atime aligns to source")
			migParamsOff := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				SourcePathIDs:      []string{sourcePathID},
				DestinationPathIDs: []string{destinationPathID},
				SidMapping:         false,
				Options: map[string]interface{}{
					"preserveAccessTime":  false,
					"preservePermissions": true,
				},
			}
			migOffConfigIDs, resp, err := CreateMigrationJob(migParamsOff, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating migration job (preserveAccessTime=false)")
			defer resp.Body.Close()
			migOffRun, resp, err := GetJobRunDetails(migOffConfigIDs[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run")
			defer resp.Body.Close()
			Expect(WaitForJobState(migOffRun.JobRuns[0].JobRunId, COMPLETED_JOBRUN)).
				To(Succeed(), "Migration job (preserveAccessTime=false) did not complete")

			Expect(ExpectAtimeEqual(srcFile, dstFile)).To(Succeed(), "migration did not align file atime")
			Expect(ExpectAtimeEqual(srcDir, dstDir)).To(Succeed(), "migration did not align dir atime")
			Expect(ExpectAtimeEqual(srcLink, dstLink)).To(Succeed(), "migration did not align symlink atime")

			// ---- 5. Migration no-op (R3) — pre-aligned atimes, no further drift ----
			By("Phase: Re-running migration when atimes are already aligned — should be a no-op")
			// Capture baselines after the previous run; an idempotent migration MUST
			// leave both source and destination atime exactly where they are.
			baselines, err := GetAtime([]string{srcFile, dstFile, srcDir, dstDir, srcLink, dstLink})
			Expect(err).NotTo(HaveOccurred(), "Error reading baselines for no-op assertion")
			Expect(len(baselines)).To(Equal(6))

			noopRunID, resp, err := TriggerAdHocJobRun(migOffConfigIDs[0])
			Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc migration for no-op assertion")
			defer resp.Body.Close()
			Expect(WaitForJobState(noopRunID, COMPLETED_JOBRUN)).To(Succeed(), "ad-hoc migration did not complete")

			afterNoOp, err := GetAtime([]string{srcFile, dstFile, srcDir, dstDir, srcLink, dstLink})
			Expect(err).NotTo(HaveOccurred(), "Error reading post-no-op atimes")
			for i, before := range baselines {
				Expect(afterNoOp[i].AtimeUnix).To(Equal(before.AtimeUnix),
					fmt.Sprintf("no-op migration drifted atime for %s (was %s, now %s)",
						before.Path, FormatAtimeUnix(before.AtimeUnix), FormatAtimeUnix(afterNoOp[i].AtimeUnix)))
			}

			// ---- 6. Incremental atime drift only — STAMP_ATIME reconciles dest ----
			By("Phase: Incremental — drift dest atime only, expect STAMP_ATIME to realign")
			driftedDestAtime := time.Date(2019, 5, 5, 5, 5, 5, 0, time.UTC)
			Expect(SetSourceAtime(dstFile, driftedDestAtime)).To(Succeed())
			Expect(SetSourceAtime(dstDir, driftedDestAtime)).To(Succeed())
			Expect(SetSourceAtime(dstLink, driftedDestAtime)).To(Succeed())

			incRunID, resp, err := TriggerAdHocJobRun(migOffConfigIDs[0])
			Expect(err).NotTo(HaveOccurred(), "Error triggering incremental ad-hoc")
			defer resp.Body.Close()
			Expect(WaitForJobState(incRunID, COMPLETED_JOBRUN)).To(Succeed(), "incremental did not complete")

			Expect(ExpectAtimeEqual(srcFile, dstFile)).To(Succeed(), "incremental did not realign file atime")
			Expect(ExpectAtimeEqual(srcDir, dstDir)).To(Succeed(), "incremental did not realign dir atime")
			Expect(ExpectAtimeEqual(srcLink, dstLink)).To(Succeed(), "incremental did not realign symlink atime")

			// ---- 7. Cutover — final atime alignment after drift ----
			By("Phase: Cutover — drift dest atime again, run bulk cutover, expect alignment")
			driftedAgain := time.Date(2017, 3, 3, 3, 3, 3, 0, time.UTC)
			Expect(SetSourceAtime(dstFile, driftedAgain)).To(Succeed())
			Expect(SetSourceAtime(dstDir, driftedAgain)).To(Succeed())
			Expect(SetSourceAtime(dstLink, driftedAgain)).To(Succeed())

			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID},
				DestinationPathIDs: []string{destinationPathID},
			}
			cutoverConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
			defer resp.Body.Close()
			Expect(cutoverConfigIDs).NotTo(BeEmpty())

			cutoverDetails, resp, err := GetJobRunDetails(cutoverConfigIDs[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting cutover job run")
			defer resp.Body.Close()
			cutoverRunID := cutoverDetails.JobRuns[0].JobRunId
			Expect(cutoverRunID).NotTo(BeEmpty())

			Expect(WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)).To(Succeed(), "cutover did not reach BLOCKED")
			approveResp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
			Expect(err).NotTo(HaveOccurred(), "Error approving cutover")
			defer approveResp.Body.Close()
			Expect(WaitForJobState(cutoverRunID, COMPLETED_JOBRUN)).To(Succeed(), "cutover did not complete")

			Expect(ExpectAtimeEqual(srcFile, dstFile)).To(Succeed(), "cutover did not align file atime")
			Expect(ExpectAtimeEqual(srcDir, dstDir)).To(Succeed(), "cutover did not align dir atime")
			Expect(ExpectAtimeEqual(srcLink, dstLink)).To(Succeed(), "cutover did not align symlink atime")
		})
	})
})

// buildTestRootPaths returns protocol-appropriate roots on source and
// destination. For NFS we use POSIX paths under the mounted volume on the
// worker; for SMB we use UNC paths against SOURCE_HOST_IPs / DESTINATION_HOST_IPs.
func buildTestRootPaths(srcVolume, dstVolume string) (string, string) {
	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		return fmt.Sprintf(`\\%s\%s\tc-007`, SOURCE_HOST_IPs[0], srcVolume),
			fmt.Sprintf(`\\%s\%s\tc-007`, DESTINATION_HOST_IPs[0], dstVolume)
	default:
		return filepath.Join("/mnt", srcVolume, "tc-007"),
			filepath.Join("/mnt", dstVolume, "tc-007")
	}
}

// joinShare joins a path segment onto a protocol-native share root.
func joinShare(root, item string) string {
	if PROTOCOL_TYPE == ProtocolSMB {
		return root + `\` + item
	}
	return filepath.Join(root, item)
}
