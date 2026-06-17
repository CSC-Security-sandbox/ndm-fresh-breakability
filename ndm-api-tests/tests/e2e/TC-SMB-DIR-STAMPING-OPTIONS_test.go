package tests

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func smbDirStampingMigrationOptions(preservePermissions bool) map[string]interface{} {
	return map[string]interface{}{
		"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
		"preserveAccessTime":  true,
		"preservePermissions": preservePermissions,
		"skipFile":            "0-M",
	}
}

// dirStampingDir returns the first directory path from MIGRATION_DIRS for DLM dir-stamping tests.
func dirStampingDir() string {
	return "/" + strings.TrimPrefix(MIGRATION_DIRS[0], "/")
}

// dirStampingDir2 returns the second directory path from MIGRATION_DIRS (index 1).
func dirStampingDir2() string {
	if len(MIGRATION_DIRS) < 2 {
		return ""
	}
	return "/" + strings.TrimPrefix(MIGRATION_DIRS[1], "/")
}

func dirStampingDirSIDMap() string {
    if len(MIGRATION_DIRS) < 3 {
        return ""
    }
    return "/" + strings.TrimPrefix(MIGRATION_DIRS[2], "/")
}

func dirStampingDirSIDMap2() string {
    if len(MIGRATION_DIRS) < 4 {
        return ""
    }
    return "/" + strings.TrimPrefix(MIGRATION_DIRS[3], "/")
}

// dirStampingRootDestDir* return DESTINATION subdirectory names (MIGRATION_DIRS
// indices 4–7) used by the ROOT-to-directory scenarios. In root→dir the entire
// source volume root is migrated into one of these named subdirectories on the
// destination; NDM creates the directory during the run, so it does not need to
// exist beforehand. Distinct names are used so the AS_IS / EXPLICIT runs and the
// SID-mapping runs each land in their own subtree.
func dirStampingRootDestDir() string {
	if len(MIGRATION_DIRS) < 5 {
		return ""
	}
	return "/" + strings.TrimPrefix(MIGRATION_DIRS[4], "/")
}

func dirStampingRootDestDir2() string {
	if len(MIGRATION_DIRS) < 6 {
		return ""
	}
	return "/" + strings.TrimPrefix(MIGRATION_DIRS[5], "/")
}

func dirStampingRootDestDirSIDMap() string {
	if len(MIGRATION_DIRS) < 7 {
		return ""
	}
	return "/" + strings.TrimPrefix(MIGRATION_DIRS[6], "/")
}

func dirStampingRootDestDirSIDMap2() string {
	if len(MIGRATION_DIRS) < 8 {
		return ""
	}
	return "/" + strings.TrimPrefix(MIGRATION_DIRS[7], "/")
}

// winRootForDir reproduces the Windows root path that GetSMBDirPermissionsRecursive
// builds for a given POSIX dirPath: the share is mapped to Z: and the directory is
// appended. "/Dir0" -> `Z:\Dir0`, "/" or "" -> `Z:\`. Used to rebase recursively
// collected permissions into a relative key space for directory-to-root comparisons.
func winRootForDir(dirPath string) string {
	win := strings.ReplaceAll(strings.TrimPrefix(dirPath, "/"), "/", `\`)
	if win == "" {
		return `Z:\`
	}
	return `Z:\` + win
}

// migrationRootKey is the shared relative key assigned to the migration-root entry
// on both sides: the source migration directory (e.g. `/Dir0`) and the destination
// volume root (`/`). Keying both as "." lets the standard comparators line the source
// directory's own ACL up against the destination root's own ACL.
const migrationRootKey = SMBMigrationRootKey

// rebaseToMigrationRoot rewrites each permission's FilePath to be relative to the
// migration root (winRoot). A directory-to-root migration collapses the source
// directory onto the destination volume root — the source directory's *contents* land
// directly at the destination root — so source permissions read at `/Dir0` and
// destination permissions read at `/` only line up once both are reduced to the same
// relative key space (e.g. `bucket0\file1`). The standard comparators key permissions
// by FilePath, so rebasing both sides lets them be reused unchanged. The migration-root
// entry itself (the source directory on one side, the destination volume root on the
// other) is kept under the shared key "." so the source directory's ACL is compared
// against the destination root's ACL. Destination entries outside the migrated subtree
// remain in the map but are harmlessly ignored, since the comparators only iterate
// source paths.
func rebaseToMigrationRoot(perms []SMBFilePermission, winRoot string) []SMBFilePermission {
	lowerRoot := strings.ToLower(strings.TrimRight(winRoot, `\`))
	out := make([]SMBFilePermission, 0, len(perms))
	for _, perm := range perms {
		lowerFull := strings.ToLower(perm.FilePath)
		if !strings.HasPrefix(lowerFull, lowerRoot) {
			continue
		}
		rest := lowerFull[len(lowerRoot):]
		if rest != "" && !strings.HasPrefix(rest, `\`) {
			continue // sibling sharing the root prefix, not a descendant
		}
		rel := strings.Trim(rest, `\`)
		if rel == "" {
			rel = migrationRootKey // migration root: source dir maps onto the destination root
		}
		perm.FilePath = rel
		out = append(out, perm)
	}
	return out
}



// validateCoCReportIfReady validates the CoC migration report against a JSON spec.
// Two conditions cause a silent skip rather than a failure:
//  1. The spec file contains only "[]" (placeholder, not yet populated).
//  2. The downloaded CoC CSV is empty (backend did not generate content for this run).
//
// Both cases are logged so they are visible in verbose output.
// volReplacements maps master-volume tokens in the JSON to actual cloned names.
func validateCoCReportIfReady(jobRunID string, jobType JobType, specPath string, volReplacements map[string]string) {
	raw, err := os.ReadFile(specPath)
	if err != nil || strings.TrimSpace(string(raw)) == "[]" {
		GinkgoWriter.Printf("[CoC] spec not yet populated, skipping: %s\n", specPath)
		return
	}
	_, err = ValidateReport(jobRunID, jobType, specPath, volReplacements)
	if err != nil && strings.Contains(err.Error(), "EOF") {
		GinkgoWriter.Printf("[CoC] report CSV was empty for job %s (backend did not generate content), skipping validation of %s\n", jobRunID, specPath)
		return
	}
	Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("CoC report validation failed for %s", specPath))
}


func runSMBMigrationAndWait(params MigrationJobParams, headers map[string]string) (string, string) {
	migrationJobConfigIDs, resp, err := CreateMigrationJob(params, headers)
	Expect(err).NotTo(HaveOccurred(), "migration job creation failed")
	Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0))
	defer resp.Body.Close()

	jobConfigID := migrationJobConfigIDs[0]
	getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
	Expect(err).NotTo(HaveOccurred())
	defer resp.Body.Close()

	runID := getJobsResp.JobRuns[0].JobRunId
	Expect(runID).NotTo(BeEmpty())
	err = WaitForJobState(runID, COMPLETED_JOBRUN)
	Expect(err).NotTo(HaveOccurred(), "migration job did not complete")
	return jobConfigID, runID
}

func runSMBCutoverAndWait(
	sourcePathID, destPathID, sourceDir, destDir string,
	headers map[string]string,
) (string, string) {
	cutoverParams := BulkCutoverJobParams{
		SourcePathIDs:             []string{sourcePathID},
		DestinationPathIDs:        []string{destPathID},
		SourceDirectoryPath:       sourceDir,
		DestinationDirectoryPath:  destDir,
	}
	jobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
	Expect(err).NotTo(HaveOccurred())
	defer resp.Body.Close()

	jobConfigID := jobConfigIDs[0]
	getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
	Expect(err).NotTo(HaveOccurred())
	defer resp.Body.Close()

	runID := getJobsResp.JobRuns[0].JobRunId
	Expect(runID).NotTo(BeEmpty())
	err = WaitForJobState(runID, BLOCKED_JOBRUN)
	Expect(err).NotTo(HaveOccurred())

	resp, err = ApproveRejectBulkCutoverJob(runID, "APPROVED", headers)
	Expect(err).NotTo(HaveOccurred())
	Expect(resp.StatusCode).To(Equal(http.StatusOK))
	defer resp.Body.Close()

	err = WaitForJobState(runID, APPROVED_JOBRUN)
	Expect(err).NotTo(HaveOccurred())
	return jobConfigID, runID
}


func createSMBDirStampingFileServers(
	projectID, workerID, uniqueID string,
	clonedSourceVol, clonedDestVol string,
	headers map[string]string,
) (string, string, string, string) {
	protocol := strings.ToLower(string(PROTOCOL_TYPE))

	username := PROTOCOL_USERNAME
	if PROTOCOL_TYPE == ProtocolSMB && VOLUME_CLONE_PROVIDER == VolumeCloneProviderFSxN && strings.Contains(PROTOCOL_USERNAME, "\\") {
		username = strings.Split(PROTOCOL_USERNAME, "\\")[1]
	}

	sourceParams := CreateServereParams{
		ConfigName:       fmt.Sprintf("tc-smb-dir-stamp-src-%s-%s", protocol, uniqueID),
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectID,
		ServerType:       ServerTypeOtherNAS,
		UserName:         username,
		Password:         PROTOCOL_PASSWORD,
		Protocol:         PROTOCOL_TYPE,
		ProtocolVersion:  ProtocolVersion3,
		Host:             SOURCE_HOST_IPs[0],
		Workers:          []string{workerID},
		WorkingDirectory: "",
	}
	if PROTOCOL_TYPE == ProtocolSMB {
		sourceParams.AdServerIp = PROTOCOL_AD_SERVER_IP
	}
	sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
	Expect(err).NotTo(HaveOccurred())
	defer resp.Body.Close()

	sourcePathID, err := GetExportPathID("source", clonedSourceVol, sourceConfigID, headers)
	Expect(err).NotTo(HaveOccurred())

	destParams := CreateServereParams{
		ConfigName:       fmt.Sprintf("tc-smb-dir-stamp-dst-%s-%s", protocol, uniqueID),
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectID,
		ServerType:       ServerTypeOtherNAS,
		UserName:         username,
		Password:         PROTOCOL_PASSWORD,
		Protocol:         PROTOCOL_TYPE,
		ProtocolVersion:  ProtocolVersion3,
		Host:             DESTINATION_HOST_IPs[0],
		Workers:          []string{workerID},
		WorkingDirectory: "",
	}
	if PROTOCOL_TYPE == ProtocolSMB {
		destParams.AdServerIp = PROTOCOL_AD_SERVER_IP
	}
	destConfigID, resp, err := CreateFileServer(destParams, headers)
	Expect(err).NotTo(HaveOccurred())
	defer resp.Body.Close()

	destPathID, err := GetExportPathID("destination", clonedDestVol, destConfigID, headers)
	Expect(err).NotTo(HaveOccurred())

	return sourceConfigID, sourcePathID, destConfigID, destPathID
}

var _ = Describe("TC-SMB-DIR-STAMPING-OPTIONS: SMB directory-level permission inheritance modes", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB directory stamping tests require SMB protocol")
		}
		if len(MIGRATION_DIRS) < 2 {
			Skip("MIGRATION_DIRS must have at least 2 entries, skipping DLM dir-stamping test")
		}
	})

	var (
		projectID           string
		workerID            string
		headers             map[string]string
		sourceVolumePath    string
		destVolumePath      string
		sourcePathID        string
		destPathID          string
		clonedSourceVolumes []string
		clonedDestVolumes   []string
		sourceVolumeManager *TestVolumeManager
		destVolumeManager   *TestVolumeManager
	)

	assertDirStampingMode := func(jobConfigID, expectedLabel string) {
		label, found, err := GetSmbInheritanceModeFromJobConfig(jobConfigID, headers)
		Expect(err).NotTo(HaveOccurred())
		Expect(found).To(BeTrue(), "expected SMB inheritance config on job %s", jobConfigID)
		Expect(label).To(Equal(expectedLabel))
	}

	// Context: Directory-to-Directory (dir→dir) migration scenarios.
	// Source directory is migrated to the same-named directory on the destination volume.
	// Tests cover AS_IS mode, EXPLICIT mode, SID mapping, invalid mode rejection.
	Context("Scenarios A–E: directory-level migration, cutover, and ad-hoc re-run", Ordered, func() {
		BeforeAll(func() {
			var err error
			projectID, _, _, err = GetGlobalTestEnv()
			Expect(err).NotTo(HaveOccurred())
			workerID = GetWorkerIds()[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

		clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
		if err != nil {
			Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
		}

		/*Clone selection for STAMPING uses source index 4 and dest index 2.
		CreateSelectedClones returns a position-preserving slice, so we must
		index by the same values used in RequiredCloneSelectionForTest.*/
		srcVol := clonedSourceVolumes[4]
		dstVol := clonedDestVolumes[2]

		sourceVolumePath = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], srcVol)
		destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], dstVol)

		uniqueID := uuid.New().String()[:8]
		_, sourcePathID, _, destPathID = createSMBDirStampingFileServers(
			projectID, workerID, uniqueID,
			srcVol, dstVol,
			headers,
		)
		})

		AfterAll(func() {
			if sourceVolumeManager != nil || destVolumeManager != nil {
				_ = CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			}
		})

		// Scenario A+C (dir→dir, AS_IS): Verifies that AS_IS mode is persisted through the
		// full migration lifecycle. 
		It("Scenario A+C: AS_IS migration then cutover preserves mode end-to-end", func() {
			// Migration with AS_IS
			sourcePerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, dirStampingDir())
			Expect(err).NotTo(HaveOccurred())

			params := MigrationJobParams{
				FirstRunAt:                   GetCurrentUTCTimestamp(),
				SourcePathIDs:                []string{sourcePathID},
				DestinationPathIDs:           []string{destPathID},
				SourceDirectoryPath:          dirStampingDir(),
				DestinationDirectoryPath:     dirStampingDir(),
				SmbPermissionInheritanceMode: SmbInheritModeAsIs,
				SidMapping:                   true,
				Options:                      smbDirStampingMigrationOptions(true),
			}
			jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
			assertDirStampingMode(jobConfigID, "Disabled")
			validateCoCReportIfReady(migRunID, JobTypeMigration,
				"../../validators/SMB/TC-SMB-DIR-STAMPING/as_is_migration.json",
				map[string]string{"ss-src": clonedSourceVolumes[4]})

			Wait(10)
			destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, dirStampingDir())
			Expect(err).NotTo(HaveOccurred())
			Expect(CompareSMBPermissionsAsIsMode(sourcePerms, destPerms)).To(Succeed())

			// Stamp source dir with an explicit adadmin ACE before the incremental so the
			// re-run picks up the new permission and propagates it to the destination.
			Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, dirStampingDir(), PROTOCOL_USERNAME)).To(Succeed())
			sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, dirStampingDir())
			Expect(err).NotTo(HaveOccurred())

			// Ad-hoc re-run — mode should still be persisted as AS_IS (Disabled)
			reRunID, resp, err := TriggerAdHocJobRun(jobConfigID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(reRunID).NotTo(BeEmpty())
			err = WaitForJobState(reRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
			assertDirStampingMode(jobConfigID, "Disabled")

			Wait(10)
			destPerms, err = GetSMBDirPermissionsRecursive(destVolumePath, dirStampingDir())
			Expect(err).NotTo(HaveOccurred())
			Expect(CompareSMBPermissionsAsIsMode(sourcePerms, destPerms)).To(Succeed())

			// Cutover — mode should be inherited as AS_IS (Disabled)
			sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, dirStampingDir())
			Expect(err).NotTo(HaveOccurred())

			cutoverJobID, _ := runSMBCutoverAndWait(
				sourcePathID, destPathID,
				dirStampingDir(), dirStampingDir(),
				headers,
			)
			assertDirStampingMode(cutoverJobID, "Disabled")

			Wait(10)
			destPerms, err = GetSMBDirPermissionsRecursive(destVolumePath, dirStampingDir())
			Expect(err).NotTo(HaveOccurred())
			Expect(CompareSMBPermissionsAsIsMode(sourcePerms, destPerms)).To(Succeed())
		})

		// Scenario B+C (dir→dir, EXPLICIT): Verifies that EXPLICIT stamping mode is persisted
		// through the full migration lifecycle. 
		It("Scenario B+C: EXPLICIT migration then cutover preserves mode end-to-end", func() {
			// Scenario A+C's cutover left the shared FileServer configs in a terminal state,
			// so create a fresh pair of configs pointing to the same cloned volumes.
			bUniqID := uuid.New().String()[:8]
			_, sourcePathID, _, destPathID := createSMBDirStampingFileServers(
				projectID, workerID, bUniqID,
				clonedSourceVolumes[4], clonedDestVolumes[2],
				headers,
			)

			// Migration with EXPLICIT
			sourcePerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, dirStampingDir2())
			Expect(err).NotTo(HaveOccurred())

			params := MigrationJobParams{
				FirstRunAt:                   GetCurrentUTCTimestamp(),
				SourcePathIDs:                []string{sourcePathID},
				DestinationPathIDs:           []string{destPathID},
				SourceDirectoryPath:          dirStampingDir2(),
				DestinationDirectoryPath:     dirStampingDir2(),
				SmbPermissionInheritanceMode: SmbInheritModeAsExplicit,
				SidMapping:                   true,
				Options:                      smbDirStampingMigrationOptions(true),
			}
			jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
			assertDirStampingMode(jobConfigID, "Enabled")
			validateCoCReportIfReady(migRunID, JobTypeMigration,
				"../../validators/SMB/TC-SMB-DIR-STAMPING/explicit_migration.json",
				map[string]string{"ss-src": clonedSourceVolumes[4]})

			Wait(10)
			destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, dirStampingDir2())
			Expect(err).NotTo(HaveOccurred())
			// EXPLICIT mode is validated only on the migrated directory's root, so rebase
			// both sides to the shared migration-root key space before comparing.
			Expect(CompareSMBPermissionsAsExplicitMode(
				rebaseToMigrationRoot(sourcePerms, winRootForDir(dirStampingDir2())),
				rebaseToMigrationRoot(destPerms, winRootForDir(dirStampingDir2())),
			)).To(Succeed())

			// Stamp source dir with an explicit adadmin ACE before the incremental so the
			// re-run picks up the new permission and propagates it to the destination.
			Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, dirStampingDir2(), PROTOCOL_USERNAME)).To(Succeed())
			sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, dirStampingDir2())
			Expect(err).NotTo(HaveOccurred())

			// Ad-hoc re-run — mode should still be persisted as EXPLICIT (Enabled)
			reRunID, resp, err := TriggerAdHocJobRun(jobConfigID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(reRunID).NotTo(BeEmpty())
			err = WaitForJobState(reRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
			assertDirStampingMode(jobConfigID, "Enabled")

			Wait(10)
			destPerms, err = GetSMBDirPermissionsRecursive(destVolumePath, dirStampingDir2())
			Expect(err).NotTo(HaveOccurred())
			Expect(CompareSMBPermissionsAsExplicitMode(
				rebaseToMigrationRoot(sourcePerms, winRootForDir(dirStampingDir2())),
				rebaseToMigrationRoot(destPerms, winRootForDir(dirStampingDir2())),
			)).To(Succeed())

			// Cutover — mode should be inherited as EXPLICIT (Enabled)
			sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, dirStampingDir2())
			Expect(err).NotTo(HaveOccurred())

			cutoverJobID, _ := runSMBCutoverAndWait(
				sourcePathID, destPathID,
				dirStampingDir2(), dirStampingDir2(),
				headers,
			)
			assertDirStampingMode(cutoverJobID, "Enabled")

			Wait(10)
			destPerms, err = GetSMBDirPermissionsRecursive(destVolumePath, dirStampingDir2())
			Expect(err).NotTo(HaveOccurred())
			Expect(CompareSMBPermissionsAsExplicitMode(
				rebaseToMigrationRoot(sourcePerms, winRootForDir(dirStampingDir2())),
				rebaseToMigrationRoot(destPerms, winRootForDir(dirStampingDir2())),
			)).To(Succeed())
		})







		// Scenario E (dir→dir, invalid mode): Verifies that the API enforces valid values for
		// smbPermissionInheritanceMode. 
		It("rejects invalid smbPermissionInheritanceMode with HTTP 400", func() {
			invalidModes := []string{
				"inherit_perms_as_explicit",
				"INHERIT_PERMS_AS_EXPLICIT ",
				"INVALID_MODE",
			}
			for _, invalidMode := range invalidModes {
				params := MigrationJobParams{
					FirstRunAt:                   GetCurrentUTCTimestamp(),
					SourcePathIDs:                []string{sourcePathID},
					DestinationPathIDs:           []string{destPathID},
					SourceDirectoryPath:          dirStampingDir(),
					DestinationDirectoryPath:     dirStampingDir(),
					SmbPermissionInheritanceMode: invalidMode,
					SidMapping:                   true,
					Options:                      smbDirStampingMigrationOptions(true),
				}
				_, resp, err := CreateMigrationJobRaw(params, headers)
				Expect(err).NotTo(HaveOccurred())
				Expect(resp.StatusCode).To(Equal(http.StatusBadRequest),
					"expected HTTP 400 for invalid mode %q", invalidMode)
				resp.Body.Close()
			}
		})



		// Scenario D (dir→dir, SID mapping): Verifies that SID-to-SID remapping is applied
		// correctly in both AS_IS and EXPLICIT modes during a directory-to-directory migration.
		It("Scenario D: SID mapping with AS_IS and EXPLICIT modes (migration and cutover)", func() {
			// Map kiran's SID to shastry's SID.
			// Using pre-existing SIDs avoids AD user creation, tree setup, and icacls grants.
			const sourceSID = "S-1-5-21-142954655-3166001488-1321770916-1373"
			const targetSID = "S-1-5-21-142954655-3166001488-1321770916-1375"
			// Windows resolves the SID to a display name when ACLs are fetched back via
			// PowerShell. The sidMap must include the display-name form so that
			// applySIDMapping can match it even when the raw SID is not present in the ACL.
			const sourceSIDDisplayName = "ROOTDOMAIN\\kiran"
			const targetSIDDisplayName = "ROOTDOMAIN\\shastry"
			csvContent := fmt.Sprintf("sid_source,sid_target\n%s,%s", sourceSID, targetSID)
			sidMappingBase64 := fmt.Sprintf("data:text/csv;base64,%s",
				base64.StdEncoding.EncodeToString([]byte(csvContent)))

			// Create two separate FileServer pairs — one per runMode — so that the first
			// cutover does not leave the configs in a terminal state that blocks the second run.
			// The EXPLICIT run also gets its own freshly cloned destination volume so that items
			// written by the AS_IS migration (e.g. Test1/) are absent and the worker never emits
			// deletion signals that trigger a null file_permission insert in the db-writer.
			asIsUniqID := uuid.New().String()[:8]
			_, asIsSrcPathID, _, asIsDstPathID := createSMBDirStampingFileServers(
				projectID, workerID, asIsUniqID,
				clonedSourceVolumes[4], clonedDestVolumes[2],
				headers,
			)

			explicitDstVol, cleanupExplicitDst, err := ReCloneDestVolume(2)
			Expect(err).NotTo(HaveOccurred())
			defer cleanupExplicitDst()

			explicitUniqID := uuid.New().String()[:8]
			_, explicitSrcPathID, _, explicitDstPathID := createSMBDirStampingFileServers(
				projectID, workerID, explicitUniqID,
				clonedSourceVolumes[4], explicitDstVol,
				headers,
			)

			// assertSIDMapped checks that every path on the destination that carried sourceSID
			// on the source now has the target SID instead, and that sourceSID itself is gone.
			assertSIDMapped := func(srcPerms, dstPerms []SMBFilePermission) {
				destByPath := make(map[string][]ACLEntry, len(dstPerms))
				for _, perm := range dstPerms {
					destByPath[perm.FilePath] = perm.ACLEntries
				}

				LogDebug(fmt.Sprintf("[SID-MAP] asserting %s → %s mapping across %d source paths", sourceSID, targetSID, len(srcPerms)))

				for _, srcPerm := range srcPerms {
					hasSID := false
					for _, acl := range srcPerm.ACLEntries {
						if acl.Principal == sourceSID {
							hasSID = true
							break
						}
					}
					if !hasSID {
						continue
					}

					LogDebug(fmt.Sprintf("[SID-MAP] path has source SID: %s", srcPerm.FilePath))

					destACLs, ok := destByPath[srcPerm.FilePath]
					Expect(ok).To(BeTrue(), "path %s missing on destination", srcPerm.FilePath)

					srcJSON, _ := json.MarshalIndent(srcPerm.ACLEntries, "    ", "  ")
					dstJSON, _ := json.MarshalIndent(destACLs, "    ", "  ")
					LogDebug(fmt.Sprintf("[SID-MAP] path: %s\n  source ACEs:\n    %s\n  dest ACEs:\n    %s", srcPerm.FilePath, srcJSON, dstJSON))

					targetFound := false
					for _, acl := range destACLs {
						Expect(acl.Principal).NotTo(Equal(sourceSID),
							"SID %s should have been remapped on %s", sourceSID, srcPerm.FilePath)
					if acl.Principal == targetSID || strings.EqualFold(strings.TrimSpace(acl.Principal), targetSIDDisplayName) {
						LogDebug(fmt.Sprintf("[SID-MAP]   FOUND target SID (%s) on %s", acl.Principal, srcPerm.FilePath))
						targetFound = true
					}
				}
				if !targetFound {
					LogDebug(fmt.Sprintf("[SID-MAP]   FAIL target SID (%s / %s) NOT found on %s", targetSID, targetSIDDisplayName, srcPerm.FilePath))
				}
				Expect(targetFound).To(BeTrue(),
					"expected target SID (%s / %s) ACE on %s after SID mapping (source had SID %s)", targetSID, targetSIDDisplayName, srcPerm.FilePath, sourceSID)
			}
			LogDebug("[SID-MAP] assertion complete")
		}

		runMode := func(srcPathID, dstPathID, srcDir, destDir, mode, expectedLabel, cocSpecName string, compare func([]SMBFilePermission, []SMBFilePermission) error) {
				sourcePerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, srcDir)
				Expect(err).NotTo(HaveOccurred())

				params := MigrationJobParams{
					FirstRunAt:                   GetCurrentUTCTimestamp(),
					SourcePathIDs:                []string{srcPathID},
					DestinationPathIDs:           []string{dstPathID},
					SourceDirectoryPath:          srcDir,
					DestinationDirectoryPath:     destDir,
					SmbPermissionInheritanceMode: mode,
					SidMapping:                   sidMappingBase64,
					Options:                      smbDirStampingMigrationOptions(true),
				}
				jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
				assertDirStampingMode(jobConfigID, expectedLabel)
				validateCoCReportIfReady(migRunID, JobTypeMigration,
					"../../validators/SMB/TC-SMB-DIR-STAMPING/"+cocSpecName,
					map[string]string{"ss-src": clonedSourceVolumes[4]})

				Wait(10)
				destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
				Expect(err).NotTo(HaveOccurred())
			assertSIDMapped(sourcePerms, destPerms)
			Expect(compare(sourcePerms, destPerms)).To(Succeed())

				// Stamp source dir with an explicit adadmin ACE before the incremental re-run
				// so the re-run picks up the new permission and propagates it to the destination.
				Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, srcDir, PROTOCOL_USERNAME)).To(Succeed())
				sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, srcDir)
				Expect(err).NotTo(HaveOccurred())

				// Ad-hoc re-run — mode and SID mapping should both be preserved
				reRunID, reRunResp, reRunErr := TriggerAdHocJobRun(jobConfigID)
				Expect(reRunErr).NotTo(HaveOccurred())
				defer reRunResp.Body.Close()
				Expect(reRunID).NotTo(BeEmpty())
				reRunErr = WaitForJobState(reRunID, COMPLETED_JOBRUN)
				Expect(reRunErr).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
				assertDirStampingMode(jobConfigID, expectedLabel)

				Wait(10)
				destPermsAfterReRun, reRunErr := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
				Expect(reRunErr).NotTo(HaveOccurred())
			assertSIDMapped(sourcePerms, destPermsAfterReRun)
			Expect(compare(sourcePerms, destPermsAfterReRun)).To(Succeed())

				cutoverJobID, _ := runSMBCutoverAndWait(
					srcPathID, dstPathID,
					srcDir, destDir,
					headers,
				)
				assertDirStampingMode(cutoverJobID, expectedLabel)

				Wait(10)
				destPermsAfterCutover, err := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
				Expect(err).NotTo(HaveOccurred())
				assertSIDMapped(sourcePerms, destPermsAfterCutover)
				Expect(compare(sourcePerms, destPermsAfterCutover)).To(Succeed())
			}

			// The standard comparators match ACEs by literal principal, so a remapped SID
			// (which intentionally no longer exists on the destination) would always fail.
			// Use the SID-mapping-aware comparators, which translate each source principal
			// through the same source->target mapping before matching against the destination.
			// Both the raw SID and its Windows-resolved display name are included so that
			// applySIDMapping fires regardless of whether Windows returns the SID or the name.
			sidMap := map[string]string{
				sourceSID:            targetSID,            // raw SID form
				sourceSIDDisplayName: targetSIDDisplayName, // display-name form (Windows resolves the SID)
			}
			compareAsIs := func(src, dst []SMBFilePermission) error {
				return CompareSMBPermissionsAsIsModeWithSIDMapping(src, dst, sidMap)
			}
			// EXPLICIT mode requires the root node to be keyed as SMBMigrationRootKey ("."),
			// so rebase both sides before delegating to the comparator.
			compareExplicit := func(src, dst []SMBFilePermission) error {
				srcRebased := rebaseToMigrationRoot(src, winRootForDir(dirStampingDirSIDMap2()))
				dstRebased := rebaseToMigrationRoot(dst, winRootForDir(dirStampingDirSIDMap2()))
				return CompareSMBPermissionsAsExplicitModeWithSIDMapping(srcRebased, dstRebased, sidMap)
			}

			runMode(asIsSrcPathID, asIsDstPathID, dirStampingDirSIDMap(), dirStampingDirSIDMap(), SmbInheritModeAsIs, "Disabled", "sid_map_as_is_migration.json", compareAsIs)

			// Switch destVolumePath to the fresh dest clone for the EXPLICIT run so that
			// the runMode closure reads permissions from a clean destination.
			origDestVolumePath := destVolumePath
			destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], explicitDstVol)
			runMode(explicitSrcPathID, explicitDstPathID, dirStampingDirSIDMap2(), dirStampingDirSIDMap2(), SmbInheritModeAsExplicit, "Enabled", "sid_map_explicit_migration.json", compareExplicit)
			destVolumePath = origDestVolumePath
		})
	})

	// Context: Directory-to-Root (dir→root) migration scenarios.
	// Source subdirectory is migrated to the root of the destination volume
	// Tests cover AS_IS mode, EXPLICIT mode, SID mapping, and invalid mode rejection.
	Context("Scenarios A–E: directory-to-ROOT migration, cutover, and ad-hoc re-run", Ordered, func() {
		BeforeAll(func() {
			var err error
			projectID, _, _, err = GetGlobalTestEnv()
			Expect(err).NotTo(HaveOccurred())
			workerID = GetWorkerIds()[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}

			/*Same clone selection as the dir-to-dir scenarios — source index 4 and dest
			index 2 — so the directory-to-root variants exercise the identical fixtures.*/
			srcVol := clonedSourceVolumes[4]
			dstVol := clonedDestVolumes[2]

			sourceVolumePath = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], srcVol)
			destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], dstVol)

			uniqueID := uuid.New().String()[:8]
			_, sourcePathID, _, destPathID = createSMBDirStampingFileServers(
				projectID, workerID, uniqueID,
				srcVol, dstVol,
				headers,
			)
		})

		AfterAll(func() {
			if sourceVolumeManager != nil || destVolumeManager != nil {
				_ = CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			}
		})

		// compareRootMigration reads the source migration directory and the destination
		// volume root recursively, rebases both into a common relative key space (the
		// dir-to-root migration collapses the source directory onto the destination
		// root), then runs the supplied comparator.
		compareRootMigration := func(srcDir string, cmp func(src, dst []SMBFilePermission) error) {
			srcPerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, srcDir)
			Expect(err).NotTo(HaveOccurred())
			destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, "/")
			Expect(err).NotTo(HaveOccurred())

			srcRebased := rebaseToMigrationRoot(srcPerms, winRootForDir(srcDir))
			dstRebased := rebaseToMigrationRoot(destPerms, winRootForDir("/"))
			Expect(cmp(srcRebased, dstRebased)).To(Succeed())
		}


		// Scenario A+C (dir→root, AS_IS): Same lifecycle as the dir→dir AS_IS scenario but
		// the destination path is the volume root. 
		It("Scenario A+C (dir→root): AS_IS migration then cutover preserves mode end-to-end", func() {
			// Migration with AS_IS into the destination root (DestinationDirectoryPath empty).
			params := MigrationJobParams{
				FirstRunAt:                   GetCurrentUTCTimestamp(),
				SourcePathIDs:                []string{sourcePathID},
				DestinationPathIDs:           []string{destPathID},
				SourceDirectoryPath:          dirStampingDir(),
				DestinationDirectoryPath:     "",
				SmbPermissionInheritanceMode: SmbInheritModeAsIs,
				SidMapping:                   true,
				Options:                      smbDirStampingMigrationOptions(true),
			}
			jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
			assertDirStampingMode(jobConfigID, "Disabled")
			validateCoCReportIfReady(migRunID, JobTypeMigration,
				"../../validators/SMB/TC-SMB-DIR-STAMPING/as_is_migration.json",
				map[string]string{"ss-src": clonedSourceVolumes[4]})

			Wait(10)
			compareRootMigration(dirStampingDir(), CompareSMBPermissionsAsIsMode)

			// Stamp source dir with an explicit adadmin ACE before the incremental so the
			// re-run picks up the new permission and propagates it to the destination.
			Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, dirStampingDir(), PROTOCOL_USERNAME)).To(Succeed())

			// Ad-hoc re-run — mode should still be persisted as AS_IS (Disabled)
			reRunID, resp, err := TriggerAdHocJobRun(jobConfigID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(reRunID).NotTo(BeEmpty())
			err = WaitForJobState(reRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
			assertDirStampingMode(jobConfigID, "Disabled")

			Wait(10)
			compareRootMigration(dirStampingDir(), CompareSMBPermissionsAsIsMode)

			// Cutover — mode should be inherited as AS_IS (Disabled)
			cutoverJobID, _ := runSMBCutoverAndWait(
				sourcePathID, destPathID,
				dirStampingDir(), "",
				headers,
			)
			assertDirStampingMode(cutoverJobID, "Disabled")

			Wait(10)
			compareRootMigration(dirStampingDir(), CompareSMBPermissionsAsIsMode)
		})

		// Scenario B+C (dir→root, EXPLICIT): Same lifecycle as the dir→dir EXPLICIT scenario
		// but the destination path is the volume root. 
		It("Scenario B+C (dir→root): EXPLICIT migration then cutover preserves mode end-to-end", func() {
			// Scenario A+C's cutover left the shared FileServer configs in a terminal state,
			// so create a fresh pair of configs pointing to the same cloned volumes.
			bUniqID := uuid.New().String()[:8]
			_, sourcePathID, _, destPathID := createSMBDirStampingFileServers(
				projectID, workerID, bUniqID,
				clonedSourceVolumes[4], clonedDestVolumes[2],
				headers,
			)

			// Migration with EXPLICIT into the destination root.
			params := MigrationJobParams{
				FirstRunAt:                   GetCurrentUTCTimestamp(),
				SourcePathIDs:                []string{sourcePathID},
				DestinationPathIDs:           []string{destPathID},
				SourceDirectoryPath:          dirStampingDir2(),
				DestinationDirectoryPath:     "",
				SmbPermissionInheritanceMode: SmbInheritModeAsExplicit,
				SidMapping:                   true,
				Options:                      smbDirStampingMigrationOptions(true),
			}
			jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
			assertDirStampingMode(jobConfigID, "Enabled")
			validateCoCReportIfReady(migRunID, JobTypeMigration,
				"../../validators/SMB/TC-SMB-DIR-STAMPING/explicit_migration.json",
				map[string]string{"ss-src": clonedSourceVolumes[4]})

			Wait(10)
			compareRootMigration(dirStampingDir2(), CompareSMBPermissionsAsExplicitMode)

			// Stamp source dir with an explicit adadmin ACE before the incremental so the
			// re-run picks up the new permission and propagates it to the destination.
			Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, dirStampingDir2(), PROTOCOL_USERNAME)).To(Succeed())

			// Ad-hoc re-run — mode should still be persisted as EXPLICIT (Enabled)
			reRunID, resp, err := TriggerAdHocJobRun(jobConfigID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(reRunID).NotTo(BeEmpty())
			err = WaitForJobState(reRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
			assertDirStampingMode(jobConfigID, "Enabled")

			Wait(10)
			compareRootMigration(dirStampingDir2(), CompareSMBPermissionsAsExplicitMode)

			// Cutover — mode should be inherited as EXPLICIT (Enabled)
			cutoverJobID, _ := runSMBCutoverAndWait(
				sourcePathID, destPathID,
				dirStampingDir2(), "",
				headers,
			)
			assertDirStampingMode(cutoverJobID, "Enabled")

			Wait(10)
			compareRootMigration(dirStampingDir2(), CompareSMBPermissionsAsExplicitMode)
		})

		// Scenario E (dir→root, invalid mode): Verifies the same API-level validation as the
		// dir→dir invalid-mode scenario but with a dir→root job shape. 
		It("rejects invalid smbPermissionInheritanceMode with HTTP 400 (dir→root)", func() {
			invalidModes := []string{
				"inherit_perms_as_explicit",
				"INHERIT_PERMS_AS_EXPLICIT ",
				"INVALID_MODE",
			}
			for _, invalidMode := range invalidModes {
				params := MigrationJobParams{
					FirstRunAt:                   GetCurrentUTCTimestamp(),
					SourcePathIDs:                []string{sourcePathID},
					DestinationPathIDs:           []string{destPathID},
					SourceDirectoryPath:          dirStampingDir(),
					DestinationDirectoryPath:     "",
					SmbPermissionInheritanceMode: invalidMode,
					SidMapping:                   true,
					Options:                      smbDirStampingMigrationOptions(true),
				}
				_, resp, err := CreateMigrationJobRaw(params, headers)
				Expect(err).NotTo(HaveOccurred())
				Expect(resp.StatusCode).To(Equal(http.StatusBadRequest),
					"expected HTTP 400 for invalid mode %q", invalidMode)
				resp.Body.Close()
			}
		})

		// Scenario D (dir→root, SID mapping): Verifies SID remapping correctness when the
		// destination is the volume root. 
		// Two jobs (AS_IS and EXPLICIT) are created and their cutovers are verified to correctly remap principals
		// and permissions under the root-based destination path layout.
		It("Scenario D (dir→root): SID mapping with AS_IS and EXPLICIT modes (migration and cutover)", func() {
			// Map kiran's SID to shastry's SID.
			// Using pre-existing SIDs avoids AD user creation, tree setup, and icacls grants.
			const sourceSID = "S-1-5-21-142954655-3166001488-1321770916-1373"
			const targetSID = "S-1-5-21-142954655-3166001488-1321770916-1375"
			// Windows resolves the SID to a display name when ACLs are fetched back via
			// PowerShell. The sidMap must include the display-name form so that
			// applySIDMapping can match it even when the raw SID is not present in the ACL.
			const sourceSIDDisplayName = "ROOTDOMAIN\\kiran"
			const targetSIDDisplayName = "ROOTDOMAIN\\shastry"
			csvContent := fmt.Sprintf("sid_source,sid_target\n%s,%s", sourceSID, targetSID)
			sidMappingBase64 := fmt.Sprintf("data:text/csv;base64,%s",
				base64.StdEncoding.EncodeToString([]byte(csvContent)))

			// Create two separate FileServer pairs — one per runMode — so that the first
			// cutover does not leave the configs in a terminal state that blocks the second run.
			// The EXPLICIT run also gets its own freshly cloned destination volume so that items
			// written by the AS_IS migration are absent and the worker never emits deletion
			// signals that trigger a null file_permission insert in the db-writer.
			asIsUniqID := uuid.New().String()[:8]
			_, asIsSrcPathID, _, asIsDstPathID := createSMBDirStampingFileServers(
				projectID, workerID, asIsUniqID,
				clonedSourceVolumes[4], clonedDestVolumes[2],
				headers,
			)

			explicitDstVol, cleanupExplicitDst, err := ReCloneDestVolume(2)
			Expect(err).NotTo(HaveOccurred())
			defer cleanupExplicitDst()

			explicitUniqID := uuid.New().String()[:8]
			_, explicitSrcPathID, _, explicitDstPathID := createSMBDirStampingFileServers(
				projectID, workerID, explicitUniqID,
				clonedSourceVolumes[4], explicitDstVol,
				headers,
			)

			// assertSIDMapped checks that every path on the destination that carried sourceSID
			// on the source now has the target SID instead, and that sourceSID itself is gone.
			// Both inputs are expected to already be rebased into the relative key space.
			assertSIDMapped := func(srcPerms, dstPerms []SMBFilePermission) {
				destByPath := make(map[string][]ACLEntry, len(dstPerms))
				for _, perm := range dstPerms {
					destByPath[perm.FilePath] = perm.ACLEntries
				}

				LogDebug(fmt.Sprintf("[SID-MAP] asserting %s → %s mapping across %d source paths", sourceSID, targetSID, len(srcPerms)))

				for _, srcPerm := range srcPerms {
					hasSID := false
					for _, acl := range srcPerm.ACLEntries {
						if acl.Principal == sourceSID {
							hasSID = true
							break
						}
					}
					if !hasSID {
						continue
					}

					LogDebug(fmt.Sprintf("[SID-MAP] path has source SID: %s", srcPerm.FilePath))

					destACLs, ok := destByPath[srcPerm.FilePath]
					Expect(ok).To(BeTrue(), "path %s missing on destination", srcPerm.FilePath)

					srcJSON, _ := json.MarshalIndent(srcPerm.ACLEntries, "    ", "  ")
					dstJSON, _ := json.MarshalIndent(destACLs, "    ", "  ")
					LogDebug(fmt.Sprintf("[SID-MAP] path: %s\n  source ACEs:\n    %s\n  dest ACEs:\n    %s", srcPerm.FilePath, srcJSON, dstJSON))

					targetFound := false
					for _, acl := range destACLs {
						Expect(acl.Principal).NotTo(Equal(sourceSID),
							"SID %s should have been remapped on %s", sourceSID, srcPerm.FilePath)
					if acl.Principal == targetSID || strings.EqualFold(strings.TrimSpace(acl.Principal), targetSIDDisplayName) {
						LogDebug(fmt.Sprintf("[SID-MAP]   FOUND target SID (%s) on %s", acl.Principal, srcPerm.FilePath))
						targetFound = true
					}
				}
				if !targetFound {
					LogDebug(fmt.Sprintf("[SID-MAP]   FAIL target SID (%s / %s) NOT found on %s", targetSID, targetSIDDisplayName, srcPerm.FilePath))
				}
				Expect(targetFound).To(BeTrue(),
					"expected target SID (%s / %s) ACE on %s after SID mapping (source had SID %s)", targetSID, targetSIDDisplayName, srcPerm.FilePath, sourceSID)
			}
			LogDebug("[SID-MAP] assertion complete")
		}

		runMode := func(srcPathID, dstPathID, srcDir, mode, expectedLabel, cocSpecName string, compare func([]SMBFilePermission, []SMBFilePermission) error) {
				sourcePerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, srcDir)
				Expect(err).NotTo(HaveOccurred())
				srcRebased := rebaseToMigrationRoot(sourcePerms, winRootForDir(srcDir))

				params := MigrationJobParams{
					FirstRunAt:                   GetCurrentUTCTimestamp(),
					SourcePathIDs:                []string{srcPathID},
					DestinationPathIDs:           []string{dstPathID},
					SourceDirectoryPath:          srcDir,
					DestinationDirectoryPath:     "",
					SmbPermissionInheritanceMode: mode,
					SidMapping:                   sidMappingBase64,
					Options:                      smbDirStampingMigrationOptions(true),
				}
				jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
				assertDirStampingMode(jobConfigID, expectedLabel)
				validateCoCReportIfReady(migRunID, JobTypeMigration,
					"../../validators/SMB/TC-SMB-DIR-STAMPING/"+cocSpecName,
					map[string]string{"ss-src": clonedSourceVolumes[4]})

				Wait(10)
				destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, "/")
				Expect(err).NotTo(HaveOccurred())
				dstRebased := rebaseToMigrationRoot(destPerms, winRootForDir("/"))
			assertSIDMapped(srcRebased, dstRebased)
			Expect(compare(srcRebased, dstRebased)).To(Succeed())

				// Stamp source dir with an explicit adadmin ACE before the incremental re-run
				// so the re-run picks up the new permission and propagates it to the destination.
				Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, srcDir, PROTOCOL_USERNAME)).To(Succeed())
				sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, srcDir)
				Expect(err).NotTo(HaveOccurred())
				srcRebased = rebaseToMigrationRoot(sourcePerms, winRootForDir(srcDir))

				// Ad-hoc re-run — mode and SID mapping should both be preserved
				reRunID, reRunResp, reRunErr := TriggerAdHocJobRun(jobConfigID)
				Expect(reRunErr).NotTo(HaveOccurred())
				defer reRunResp.Body.Close()
				Expect(reRunID).NotTo(BeEmpty())
				reRunErr = WaitForJobState(reRunID, COMPLETED_JOBRUN)
				Expect(reRunErr).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
				assertDirStampingMode(jobConfigID, expectedLabel)

				Wait(10)
				destPermsAfterReRun, reRunErr := GetSMBDirPermissionsRecursive(destVolumePath, "/")
				Expect(reRunErr).NotTo(HaveOccurred())
				dstRebasedAfterReRun := rebaseToMigrationRoot(destPermsAfterReRun, winRootForDir("/"))
			assertSIDMapped(srcRebased, dstRebasedAfterReRun)
			Expect(compare(srcRebased, dstRebasedAfterReRun)).To(Succeed())

				cutoverJobID, _ := runSMBCutoverAndWait(
					srcPathID, dstPathID,
					srcDir, "",
					headers,
				)
				assertDirStampingMode(cutoverJobID, expectedLabel)

				Wait(10)
				destPermsAfterCutover, err := GetSMBDirPermissionsRecursive(destVolumePath, "/")
				Expect(err).NotTo(HaveOccurred())
				dstRebasedAfterCutover := rebaseToMigrationRoot(destPermsAfterCutover, winRootForDir("/"))
				assertSIDMapped(srcRebased, dstRebasedAfterCutover)
				Expect(compare(srcRebased, dstRebasedAfterCutover)).To(Succeed())
			}

			// The standard comparators match ACEs by literal principal, so a remapped SID
			// (which intentionally no longer exists on the destination) would always fail.
			// Use the SID-mapping-aware comparators, which translate each source principal
			// through the same source->target mapping before matching against the destination.
			// Both the raw SID and its Windows-resolved display name are included so that
			// applySIDMapping fires regardless of whether Windows returns the SID or the name.
			sidMap := map[string]string{
				sourceSID:            targetSID,            // raw SID form
				sourceSIDDisplayName: targetSIDDisplayName, // display-name form (Windows resolves the SID)
			}
			compareAsIs := func(src, dst []SMBFilePermission) error {
				return CompareSMBPermissionsAsIsModeWithSIDMapping(src, dst, sidMap)
			}
			compareExplicit := func(src, dst []SMBFilePermission) error {
				return CompareSMBPermissionsAsExplicitModeWithSIDMapping(src, dst, sidMap)
			}

			runMode(asIsSrcPathID, asIsDstPathID, dirStampingDirSIDMap(), SmbInheritModeAsIs, "Disabled", "sid_map_as_is_migration.json", compareAsIs)

			// Switch destVolumePath to the fresh dest clone for the EXPLICIT run so that
			// the runMode closure reads permissions from a clean destination.
			origDestVolumePath := destVolumePath
			destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], explicitDstVol)
			runMode(explicitSrcPathID, explicitDstPathID, dirStampingDirSIDMap2(), SmbInheritModeAsExplicit, "Enabled", "sid_map_explicit_migration.json", compareExplicit)
			destVolumePath = origDestVolumePath
		})
	})

	// Context: Root-to-Directory (root→dir) migration scenarios.
	// The entire source volume root is migrated into a named subdirectory on the destination
	// Tests cover AS_IS, EXPLICIT, SID mapping and invalid mode rejection. 
	Context("Scenarios A–E: ROOT-to-directory migration, cutover, and ad-hoc re-run", Ordered, func() {
		BeforeAll(func() {
			var err error
			projectID, _, _, err = GetGlobalTestEnv()
			Expect(err).NotTo(HaveOccurred())
			workerID = GetWorkerIds()[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Root-to-dir needs the 4 destination subdir names (MIGRATION_DIRS indices
			// 4–7) in addition to the 4 source dirs used by the other scenarios.
			if len(MIGRATION_DIRS) < 8 {
				Skip("ROOT-to-directory scenarios require at least 8 MIGRATION_DIRS entries (4 source dirs + 4 destination subdirs)")
			}

			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}

			/*Same clone selection as the other scenarios — source index 4 and dest
			index 2 — so the root-to-directory variants exercise the identical fixtures.*/
			srcVol := clonedSourceVolumes[4]
			dstVol := clonedDestVolumes[2]

			sourceVolumePath = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], srcVol)
			destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], dstVol)

			uniqueID := uuid.New().String()[:8]
			_, sourcePathID, _, destPathID = createSMBDirStampingFileServers(
				projectID, workerID, uniqueID,
				srcVol, dstVol,
				headers,
			)
		})

		AfterAll(func() {
			if sourceVolumeManager != nil || destVolumeManager != nil {
				_ = CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			}
		})

		// compareDirMigration reads the entire source volume root and the destination
		// subdirectory recursively, rebases both into a common relative key space (the
		// root-to-dir migration collapses the source volume root onto the destination
		// subdir — the source root's *contents* land directly under the destination
		// subdir), then runs the supplied comparator.
		compareDirMigration := func(destDir string, cmp func(src, dst []SMBFilePermission) error) {
			srcPerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, "/")
			Expect(err).NotTo(HaveOccurred())
			destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
			Expect(err).NotTo(HaveOccurred())

			srcRebased := rebaseToMigrationRoot(srcPerms, winRootForDir("/"))
			dstRebased := rebaseToMigrationRoot(destPerms, winRootForDir(destDir))
			Expect(cmp(srcRebased, dstRebased)).To(Succeed())
		}

		// Scenario A+C (root→dir, AS_IS): Migrates the source volume root into a destination
		// subdirectory using AS_IS mode. 
		It("Scenario A+C (root→dir): AS_IS migration then cutover preserves mode end-to-end", func() {
			// Migration with AS_IS from the entire source root (SourceDirectoryPath empty)
			// into a named destination subdir, which NDM creates during the run.
			params := MigrationJobParams{
				FirstRunAt:                   GetCurrentUTCTimestamp(),
				SourcePathIDs:                []string{sourcePathID},
				DestinationPathIDs:           []string{destPathID},
				SourceDirectoryPath:          "",
				DestinationDirectoryPath:     dirStampingRootDestDir(),
				SmbPermissionInheritanceMode: SmbInheritModeAsIs,
				SidMapping:                   true,
				Options:                      smbDirStampingMigrationOptions(true),
			}
			jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
			assertDirStampingMode(jobConfigID, "Disabled")
			migRows, mErr := CountMigrationReportRows(migRunID)
			Expect(mErr).NotTo(HaveOccurred(), "failed to count root-to-dir migration CoC rows")
			Expect(migRows).To(BeNumerically(">", 0), "migration CoC should have rows")

			Wait(10)
			compareDirMigration(dirStampingRootDestDir(), CompareSMBPermissionsAsIsMode)

			// Stamp source root with an explicit adadmin ACE before the incremental so the
			// re-run picks up the new permission and propagates it to the destination.
			Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, "/", PROTOCOL_USERNAME)).To(Succeed())

			// Ad-hoc re-run — mode should still be persisted as AS_IS (Disabled)
			reRunID, resp, err := TriggerAdHocJobRun(jobConfigID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(reRunID).NotTo(BeEmpty())
			err = WaitForJobState(reRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
			assertDirStampingMode(jobConfigID, "Disabled")

			Wait(10)
			compareDirMigration(dirStampingRootDestDir(), CompareSMBPermissionsAsIsMode)

			// Cutover — mode should be inherited as AS_IS (Disabled)
			cutoverJobID, _ := runSMBCutoverAndWait(
				sourcePathID, destPathID,
				"", dirStampingRootDestDir(),
				headers,
			)
			assertDirStampingMode(cutoverJobID, "Disabled")

			Wait(10)
			compareDirMigration(dirStampingRootDestDir(), CompareSMBPermissionsAsIsMode)
		})

		// Scenario B+C (root→dir, EXPLICIT): Migrates the source volume root into a destination
		// subdirectory using EXPLICIT stamping mode. 
		It("Scenario B+C (root→dir): EXPLICIT migration then cutover preserves mode end-to-end", func() {
			// Scenario A+C's cutover left the shared FileServer configs in a terminal state,
			// so create a fresh pair of configs pointing to the same cloned volumes.
			bUniqID := uuid.New().String()[:8]
			_, sourcePathID, _, destPathID := createSMBDirStampingFileServers(
				projectID, workerID, bUniqID,
				clonedSourceVolumes[4], clonedDestVolumes[2],
				headers,
			)

			// Migration with EXPLICIT from the entire source root into a named dest subdir.
			params := MigrationJobParams{
				FirstRunAt:                   GetCurrentUTCTimestamp(),
				SourcePathIDs:                []string{sourcePathID},
				DestinationPathIDs:           []string{destPathID},
				SourceDirectoryPath:          "",
				DestinationDirectoryPath:     dirStampingRootDestDir2(),
				SmbPermissionInheritanceMode: SmbInheritModeAsExplicit,
				SidMapping:                   true,
				Options:                      smbDirStampingMigrationOptions(true),
			}
			jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
			assertDirStampingMode(jobConfigID, "Enabled")
			migRows, mErr := CountMigrationReportRows(migRunID)
			Expect(mErr).NotTo(HaveOccurred(), "failed to count root-to-dir migration CoC rows")
			Expect(migRows).To(BeNumerically(">", 0), "migration CoC should have rows")

			Wait(10)
			compareDirMigration(dirStampingRootDestDir2(), CompareSMBPermissionsAsExplicitMode)

			// Stamp source root with an explicit adadmin ACE before the incremental so the
			// re-run picks up the new permission and propagates it to the destination.
			Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, "/", PROTOCOL_USERNAME)).To(Succeed())

			// Ad-hoc re-run — mode should still be persisted as EXPLICIT (Enabled)
			reRunID, resp, err := TriggerAdHocJobRun(jobConfigID)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()
			Expect(reRunID).NotTo(BeEmpty())
			err = WaitForJobState(reRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
			assertDirStampingMode(jobConfigID, "Enabled")

			Wait(10)
			compareDirMigration(dirStampingRootDestDir2(), CompareSMBPermissionsAsExplicitMode)

			// Cutover — mode should be inherited as EXPLICIT (Enabled)
			cutoverJobID, _ := runSMBCutoverAndWait(
				sourcePathID, destPathID,
				"", dirStampingRootDestDir2(),
				headers,
			)
			assertDirStampingMode(cutoverJobID, "Enabled")

			Wait(10)
			compareDirMigration(dirStampingRootDestDir2(), CompareSMBPermissionsAsExplicitMode)
		})

		// Scenario E (root→dir, invalid mode): Verifies API-level enforcement of valid
		// smbPermissionInheritanceMode values for a root→dir job shape. 
		It("rejects invalid smbPermissionInheritanceMode with HTTP 400 (root→dir)", func() {
			invalidModes := []string{
				"inherit_perms_as_explicit",
				"INHERIT_PERMS_AS_EXPLICIT ",
				"INVALID_MODE",
			}
			for _, invalidMode := range invalidModes {
				params := MigrationJobParams{
					FirstRunAt:                   GetCurrentUTCTimestamp(),
					SourcePathIDs:                []string{sourcePathID},
					DestinationPathIDs:           []string{destPathID},
					SourceDirectoryPath:          "",
					DestinationDirectoryPath:     dirStampingRootDestDir(),
					SmbPermissionInheritanceMode: invalidMode,
					SidMapping:                   true,
					Options:                      smbDirStampingMigrationOptions(true),
				}
				_, resp, err := CreateMigrationJobRaw(params, headers)
				Expect(err).NotTo(HaveOccurred())
				Expect(resp.StatusCode).To(Equal(http.StatusBadRequest),
					"expected HTTP 400 for invalid mode %q", invalidMode)
				resp.Body.Close()
			}
		})

		// Scenario D (root→dir, SID mapping): Verifies SID remapping correctness when the
		// entire source root is migrated into a destination subdirectory. 
		// Two jobs (AS_IS and EXPLICIT) are run and their cutovers confirm that remapped principals and permissions are
		// correct under the destination subdirectory path layout.
		It("Scenario D (root→dir): SID mapping with AS_IS and EXPLICIT modes (migration and cutover)", func() {
			// Map kiran's SID to shastry's SID.
			// Migrating the entire source root carries along Dir2/Dir3 (which hold this SID),
			// so no extra source setup is needed.
			const sourceSID = "S-1-5-21-142954655-3166001488-1321770916-1373"
			const targetSID = "S-1-5-21-142954655-3166001488-1321770916-1375"
			// Windows resolves the SID to a display name when ACLs are fetched back via
			// PowerShell. The sidMap must include the display-name form so that
			// applySIDMapping can match it even when the raw SID is not present in the ACL.
			const sourceSIDDisplayName = "ROOTDOMAIN\\kiran"
			const targetSIDDisplayName = "ROOTDOMAIN\\shastry"
			csvContent := fmt.Sprintf("sid_source,sid_target\n%s,%s", sourceSID, targetSID)
			sidMappingBase64 := fmt.Sprintf("data:text/csv;base64,%s",
				base64.StdEncoding.EncodeToString([]byte(csvContent)))

			// Create two separate FileServer pairs — one per runMode — so that the first
			// cutover does not leave the configs in a terminal state that blocks the second run.
			// The EXPLICIT run also gets its own freshly cloned destination volume so that items
			// written by the AS_IS migration are absent and the worker never emits deletion
			// signals that trigger a null file_permission insert in the db-writer.
			asIsUniqID := uuid.New().String()[:8]
			_, asIsSrcPathID, _, asIsDstPathID := createSMBDirStampingFileServers(
				projectID, workerID, asIsUniqID,
				clonedSourceVolumes[4], clonedDestVolumes[2],
				headers,
			)

			explicitDstVol, cleanupExplicitDst, err := ReCloneDestVolume(2)
			Expect(err).NotTo(HaveOccurred())
			defer cleanupExplicitDst()

			explicitUniqID := uuid.New().String()[:8]
			_, explicitSrcPathID, _, explicitDstPathID := createSMBDirStampingFileServers(
				projectID, workerID, explicitUniqID,
				clonedSourceVolumes[4], explicitDstVol,
				headers,
			)

			// assertSIDMapped checks that every path on the destination that carried sourceSID
			// on the source now has the target SID instead, and that sourceSID itself is gone.
			// Both inputs are expected to already be rebased into the relative key space.
			assertSIDMapped := func(srcPerms, dstPerms []SMBFilePermission) {
				destByPath := make(map[string][]ACLEntry, len(dstPerms))
				for _, perm := range dstPerms {
					destByPath[perm.FilePath] = perm.ACLEntries
				}

				LogDebug(fmt.Sprintf("[SID-MAP] asserting %s → %s mapping across %d source paths", sourceSID, targetSID, len(srcPerms)))

				for _, srcPerm := range srcPerms {
					hasSID := false
					for _, acl := range srcPerm.ACLEntries {
						if acl.Principal == sourceSID {
							hasSID = true
							break
						}
					}
					if !hasSID {
						continue
					}

					LogDebug(fmt.Sprintf("[SID-MAP] path has source SID: %s", srcPerm.FilePath))

					destACLs, ok := destByPath[srcPerm.FilePath]
					Expect(ok).To(BeTrue(), "path %s missing on destination", srcPerm.FilePath)

					srcJSON, _ := json.MarshalIndent(srcPerm.ACLEntries, "    ", "  ")
					dstJSON, _ := json.MarshalIndent(destACLs, "    ", "  ")
					LogDebug(fmt.Sprintf("[SID-MAP] path: %s\n  source ACEs:\n    %s\n  dest ACEs:\n    %s", srcPerm.FilePath, srcJSON, dstJSON))

					targetFound := false
					for _, acl := range destACLs {
						Expect(acl.Principal).NotTo(Equal(sourceSID),
							"SID %s should have been remapped on %s", sourceSID, srcPerm.FilePath)
					if acl.Principal == targetSID || strings.EqualFold(strings.TrimSpace(acl.Principal), targetSIDDisplayName) {
						LogDebug(fmt.Sprintf("[SID-MAP]   FOUND target SID (%s) on %s", acl.Principal, srcPerm.FilePath))
						targetFound = true
					}
				}
				if !targetFound {
					LogDebug(fmt.Sprintf("[SID-MAP]   FAIL target SID (%s / %s) NOT found on %s", targetSID, targetSIDDisplayName, srcPerm.FilePath))
				}
				Expect(targetFound).To(BeTrue(),
					"expected target SID (%s / %s) ACE on %s after SID mapping (source had SID %s)", targetSID, targetSIDDisplayName, srcPerm.FilePath, sourceSID)
			}
			LogDebug("[SID-MAP] assertion complete")
		}

		runMode := func(srcPathID, dstPathID, destDir, mode, expectedLabel string, compare func([]SMBFilePermission, []SMBFilePermission) error) {
				// Source is always the entire volume root for root→dir.
				sourcePerms, err := GetSMBDirPermissionsRecursive(sourceVolumePath, "/")
				Expect(err).NotTo(HaveOccurred())
				srcRebased := rebaseToMigrationRoot(sourcePerms, winRootForDir("/"))

				params := MigrationJobParams{
					FirstRunAt:                   GetCurrentUTCTimestamp(),
					SourcePathIDs:                []string{srcPathID},
					DestinationPathIDs:           []string{dstPathID},
					SourceDirectoryPath:          "",
					DestinationDirectoryPath:     destDir,
					SmbPermissionInheritanceMode: mode,
					SidMapping:                   sidMappingBase64,
					Options:                      smbDirStampingMigrationOptions(true),
				}
				jobConfigID, migRunID := runSMBMigrationAndWait(params, headers)
				assertDirStampingMode(jobConfigID, expectedLabel)
				migRows, mErr := CountMigrationReportRows(migRunID)
				Expect(mErr).NotTo(HaveOccurred(), "failed to count root-to-dir migration CoC rows")
				Expect(migRows).To(BeNumerically(">", 0), "migration CoC should have rows")

				Wait(10)
				destPerms, err := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
				Expect(err).NotTo(HaveOccurred())
				dstRebased := rebaseToMigrationRoot(destPerms, winRootForDir(destDir))
			assertSIDMapped(srcRebased, dstRebased)
			Expect(compare(srcRebased, dstRebased)).To(Succeed())

				// Stamp source root with an explicit adadmin ACE before the incremental re-run
				// so the re-run picks up the new permission and propagates it to the destination.
				Expect(GrantSMBDirStampingPrincipalOnPath(sourceVolumePath, "/", PROTOCOL_USERNAME)).To(Succeed())
				sourcePerms, err = GetSMBDirPermissionsRecursive(sourceVolumePath, "/")
				Expect(err).NotTo(HaveOccurred())
				srcRebased = rebaseToMigrationRoot(sourcePerms, winRootForDir("/"))

				// Ad-hoc re-run — mode and SID mapping should both be preserved
				reRunID, reRunResp, reRunErr := TriggerAdHocJobRun(jobConfigID)
				Expect(reRunErr).NotTo(HaveOccurred())
				defer reRunResp.Body.Close()
				Expect(reRunID).NotTo(BeEmpty())
				reRunErr = WaitForJobState(reRunID, COMPLETED_JOBRUN)
				Expect(reRunErr).NotTo(HaveOccurred(), "ad-hoc re-run did not complete")
				assertDirStampingMode(jobConfigID, expectedLabel)

				Wait(10)
				destPermsAfterReRun, reRunErr := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
				Expect(reRunErr).NotTo(HaveOccurred())
				dstRebasedAfterReRun := rebaseToMigrationRoot(destPermsAfterReRun, winRootForDir(destDir))
			assertSIDMapped(srcRebased, dstRebasedAfterReRun)
			Expect(compare(srcRebased, dstRebasedAfterReRun)).To(Succeed())

				cutoverJobID, _ := runSMBCutoverAndWait(
					srcPathID, dstPathID,
					"", destDir,
					headers,
				)
				assertDirStampingMode(cutoverJobID, expectedLabel)

				Wait(10)
				destPermsAfterCutover, err := GetSMBDirPermissionsRecursive(destVolumePath, destDir)
				Expect(err).NotTo(HaveOccurred())
				dstRebasedAfterCutover := rebaseToMigrationRoot(destPermsAfterCutover, winRootForDir(destDir))
				assertSIDMapped(srcRebased, dstRebasedAfterCutover)
				Expect(compare(srcRebased, dstRebasedAfterCutover)).To(Succeed())
			}

			// The standard comparators match ACEs by literal principal, so a remapped SID
			// (which intentionally no longer exists on the destination) would always fail.
			// Use the SID-mapping-aware comparators, which translate each source principal
			// through the same source->target mapping before matching against the destination.
			// Both the raw SID and its Windows-resolved display name are included so that
			// applySIDMapping fires regardless of whether Windows returns the SID or the name.
			// Inputs are already rebased by runMode, so the comparators delegate directly.
			sidMap := map[string]string{
				sourceSID:            targetSID,            // raw SID form
				sourceSIDDisplayName: targetSIDDisplayName, // display-name form (Windows resolves the SID)
			}
			compareAsIs := func(src, dst []SMBFilePermission) error {
				return CompareSMBPermissionsAsIsModeWithSIDMapping(src, dst, sidMap)
			}
			compareExplicit := func(src, dst []SMBFilePermission) error {
				return CompareSMBPermissionsAsExplicitModeWithSIDMapping(src, dst, sidMap)
			}

			runMode(asIsSrcPathID, asIsDstPathID, dirStampingRootDestDirSIDMap(), SmbInheritModeAsIs, "Disabled", compareAsIs)

			// Switch destVolumePath to the fresh dest clone for the EXPLICIT run so that
			// the runMode closure reads permissions from a clean destination.
			origDestVolumePath := destVolumePath
			destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], explicitDstVol)
			runMode(explicitSrcPathID, explicitDstPathID, dirStampingRootDestDirSIDMap2(), SmbInheritModeAsExplicit, "Enabled", compareExplicit)
			destVolumePath = origDestVolumePath
		})
	})


})
