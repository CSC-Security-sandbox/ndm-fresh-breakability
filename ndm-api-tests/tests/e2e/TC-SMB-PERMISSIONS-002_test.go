package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-SMB-PERMISSIONS-NO-SID-MAPPING: Test SMB permissions with valid/invalid principals WITHOUT SID mapping", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB permissions is skipped in CI/CD as it is not supported in NFS")
		}
	})
	var (
		ProjectId              string
		workerId1              string
		workerIds              []string
		err                    error
		destinationVolumePath1 string
		sourceVolumePath1      string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
	)

	Context("SMB Permissions Migration Without SID Mapping Test", func() {
		BeforeEach(func() {
			numberOfWorker := 1

			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)

			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[2], DESTINATION_VOLUMES[2])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[3], SOURCE_VOLUMES[3])
		})

		It("TC-SMB-NO-SID-MAPPING: Should handle valid/invalid principals without SID mapping during migration", func() {
			By("########################## TC-SMB-NO-SID-MAPPING start ################################")
			var sourceConfigID, sourcePathID1 string
			var destinationConfigID, destinationPathID1 string
			var migrationJobConfigIDs []string

			By("Ensuring Windows worker is joined to Active Directory domain")
			// Get domain credentials from environment variables
			domainName := "rootdomain.local" // Default value

			domainUser := PROTOCOL_USERNAME
			if domainUser == "" {
				Skip("AZURE_SMB_PROTOCOL_USERNAME not set - cannot join domain. Set this environment variable to run AD tests.")
			}

			domainPassword := PROTOCOL_PASSWORD
			if domainPassword == "" {
				Skip("AZURE_SMB_PROTOCOL_PASSWORD not set - cannot join domain. Set this environment variable to run AD tests.")
			}

			LogDebug(fmt.Sprintf("Domain join parameters: domain=%s, user=%s", domainName, domainUser))
			err = EnsureWindowsWorkerDomainJoined(domainName, domainUser, domainPassword)
			Expect(err).NotTo(HaveOccurred(), "Error joining Windows worker to domain")
			LogDebug("Windows worker is domain-joined and ready for AD operations")

			Wait(10) // Allow domain services to stabilize

			By("Installing Active Directory PowerShell module on Windows worker")
			err = InstallADPowerShellModule()
			Expect(err).NotTo(HaveOccurred(), "Error installing AD PowerShell module")
			LogDebug("AD PowerShell module installed successfully")

			Wait(5)

			// TEST SCENARIO: Testing orphaned SID handling with SidMapping=false
			//
			// SUMMARY: Verifies that SMB migration without SID mapping correctly preserves both valid
			// and orphaned (deleted) AD principals in ACLs. Expected: All SIDs preserved as-is at
			// destination, orphaned SIDs remain unresolved but functional.
			//
			// Test flow:
			// 1. Create files with permissions for BOTH valid and invalid principals (all exist in AD initially)
			// 2. DELETE invalid principals from Active Directory (creates orphaned SIDs in ACLs)
			// 3. Run migration with SidMapping=false (no SID resolution)
			// 4. Verify behavior:
			//    - Valid principals: ACLs should be migrated normally
			//    - Invalid principals: ACLs may be migrated as orphaned SIDs or stripped
			//
			// Define test principals
			// Valid principals: exist in AD throughout the test, have access on BOTH source and destination
			validUsers := []string{"rootdomain\\invaliduser1", "rootdomain\\invaliduser2"}
			validGroups := []string{"rootdomain\\invalidgroup1"}

			// Invalid principals: will be DELETED from AD after file creation (become orphaned SIDs)
			invalidUsers := []string{"rootdomain\\invusr11760105113", "rootdomain\\invusr21760105113"}
			invalidGroups := []string{"rootdomain\\invgrp11760105113"}

			By("Principal configuration summary")
			LogDebug(fmt.Sprintf("Valid Users (remain in AD):     %v", validUsers))
			LogDebug(fmt.Sprintf("Valid Groups (remain in AD):    %v", validGroups))
			LogDebug(fmt.Sprintf("Invalid Users (will be DELETED from AD):   %v", invalidUsers))
			LogDebug(fmt.Sprintf("Invalid Groups (will be DELETED from AD):  %v", invalidGroups))
			LogDebug("NOTE: Both volumes are on same AD. Invalid principals will be DELETED to create orphaned SIDs.")

			By("Creating source SMB file server")
			sourceParams := CreateServereParams{
				ConfigName:       "source-smb-no-sid-mapping",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[3],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source SMB file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			LogDebug(fmt.Sprintf("Source file server created: %s", sourceConfigID))

			By("Getting source export path ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[3], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting source export path")
			LogDebug(fmt.Sprintf("Source export path ID: %s", sourcePathID1))

			Wait(3)

			By("Creating test files with valid and invalid principal permissions")
			err = CreateSMBFilesWithMixedPrincipals(sourceVolumePath1, validUsers, invalidUsers, validGroups, invalidGroups)
			Expect(err).NotTo(HaveOccurred(), "Error creating files with mixed principals")
			LogDebug("Created test files with VALID and INVALID user/group permissions")

			Wait(5)

			By("Capturing source permissions WITH SID information")
			sourcePermsWithSID, err := GetSMBPermissionsWithSID(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error capturing source permissions with SID")
			Expect(len(sourcePermsWithSID)).To(BeNumerically(">", 0))
			LogDebug(fmt.Sprintf("Captured %d files/directories with SID info on source", len(sourcePermsWithSID)))

			// Log source permissions with SID details
			LogDebug("=== SOURCE PERMISSIONS WITH SID (BEFORE DELETION) ===")
			validPrincipalCount := 0
			for _, perm := range sourcePermsWithSID {
				LogDebug(fmt.Sprintf("File: %s", perm.FilePath))
				for _, acl := range perm.ACLEntries {
					if acl.ExistsInAD && !acl.IsOrphaned {
						validPrincipalCount++
					}
					LogDebug(fmt.Sprintf("  - Name: %s, SID: %s, ExistsInAD: %v, Orphaned: %v, Perms: %s",
						acl.DisplayName, acl.SID, acl.ExistsInAD, acl.IsOrphaned, acl.Permissions))
				}
			}
			LogDebug(fmt.Sprintf("Total valid principals in source (before deletion): %d", validPrincipalCount))

			By("DELETING invalid principals from Active Directory")
			By("This creates orphaned SIDs in the ACLs - the key test scenario")
			err = DeleteADPrincipals(invalidUsers, invalidGroups)
			Expect(err).NotTo(HaveOccurred(), "Error deleting invalid principals from AD")
			LogDebug(fmt.Sprintf("Deleted from AD: users=%v, groups=%v", invalidUsers, invalidGroups))
			LogDebug("ACL entries for these principals are now ORPHANED (point to non-existent SIDs)")

			By("Clearing all SMB sessions and Windows name caches")
			err = ClearAllSMBSessions()
			Expect(err).NotTo(HaveOccurred(), "Error clearing SMB sessions")
			LogDebug("SMB sessions cleared - forcing fresh connections")

			By("Waiting for AD deletion to propagate")
			LogDebug("Allowing time for AD replication and cache expiration")
			Wait(180)

			By("Re-reading source permissions AFTER deletion - verifying orphaned SIDs")
			sourcePermsAfterDeletion, err := GetSMBPermissionsWithSID(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error re-reading source permissions with SID")
			LogDebug(fmt.Sprintf("Re-captured %d files/directories (AFTER deletion)", len(sourcePermsAfterDeletion)))

			orphanedSIDsInSource := 0
			validSIDsInSource := 0
			LogDebug("=== SOURCE PERMISSIONS AFTER AD DELETION ===")
			for _, perm := range sourcePermsAfterDeletion {
				for _, acl := range perm.ACLEntries {
					if acl.IsOrphaned && strings.HasPrefix(acl.SID, "S-1-5-21-") {
						orphanedSIDsInSource++
						LogDebug(fmt.Sprintf("Orphaned SID in source: %s (name: %s) on file %s (permissions: %s)",
							acl.SID, acl.DisplayName, perm.FilePath, acl.Permissions))
					} else if acl.ExistsInAD && strings.HasPrefix(acl.SID, "S-1-5-21-") {
						validSIDsInSource++
					}
				}
			}

			Expect(orphanedSIDsInSource).To(Equal(4), "Expected exactly 4 orphaned SIDs after deleting 2 users and 1 group (4 ACL entries total)")
			Expect(validSIDsInSource).To(Equal(4), "Expected exactly 4 valid SIDs remaining (invaliduser1 x2, invaliduser2, invalidgroup1)")
			LogDebug(fmt.Sprintf("Source after deletion: Valid SIDs=%d, Orphaned SIDs=%d", validSIDsInSource, orphanedSIDsInSource))

			By("Creating destination SMB file server")
			destinationParams := CreateServereParams{
				ConfigName:       "dest-smb-no-sid-mapping",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[2],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			By("Getting the destination file server export path ID")
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[2], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred())

			By("No DENY ACLs needed - invalid principals were deleted from AD")
			LogDebug("Invalid users/groups no longer exist in AD - their ACLs are orphaned SIDs")

			Wait(5)

			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false, // NO SID MAPPING
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}

			By("Creating a migration job to migrate permissions without SID mapping")
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			migrationJobConfigID := migrationJobConfigIDs[0]
			getMigrationJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			By("Waiting for migration job to complete")
			migrationJobRunID := getMigrationJobsResp.JobRuns[0].JobRunId
			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred())
			LogDebug(fmt.Sprintf("Migration completed: %s", migrationJobRunID))

			Wait(15)

			By("Capturing destination permissions WITH SID information")
			destPermsWithSID, err := GetSMBPermissionsWithSID(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error capturing destination permissions with SID")

			LogDebug(fmt.Sprintf("Destination permissions: %d files/directories", len(destPermsWithSID)))

			// Log detailed destination permissions for debugging
			LogDebug("=== DESTINATION PERMISSIONS WITH SID ===")
			for _, perm := range destPermsWithSID {
				LogDebug(fmt.Sprintf("File: %s", perm.FilePath))
				for _, acl := range perm.ACLEntries {
					LogDebug(fmt.Sprintf("  - Name: %s, SID: %s, ExistsInAD: %v, Orphaned: %v, Perms: %s",
						acl.DisplayName, acl.SID, acl.ExistsInAD, acl.IsOrphaned, acl.Permissions))
				}
			}

			By("Comparing source and destination permissions BY SID")
			By("Valid principals: Match by SID and verify name resolution")
			By("Orphaned principals: Match by SID only (names won't resolve in AD)")
			By("Using source permissions AFTER AD deletion (with orphaned SIDs)")

			validMatches, orphanedMatches, mismatches, err := CompareSMBPermissionsBySID(sourcePermsAfterDeletion, destPermsWithSID)

			// Log all matches
			LogDebug("\n=== PERMISSION COMPARISON RESULTS ===")
			LogDebug(fmt.Sprintf("Valid Principal Matches: %d", len(validMatches)))
			for _, match := range validMatches {
				LogDebug(match)
			}

			LogDebug(fmt.Sprintf("\nOrphaned SID Matches: %d", len(orphanedMatches)))
			for _, match := range orphanedMatches {
				LogDebug(match)
			}

			if len(mismatches) > 0 {
				LogDebug(fmt.Sprintf("\nMismatches: %d", len(mismatches)))
				for _, mismatch := range mismatches {
					LogDebug(fmt.Sprintf("  ✗ %s", mismatch))
				}
			}

			// Verify expectations
			Expect(err).To(BeNil(), "SID-based permission comparison should succeed")
			Expect(len(validMatches)).To(BeNumerically(">", 0), "Should have valid principal matches")
			Expect(len(orphanedMatches)).To(BeNumerically(">", 0), "Should have orphaned SID matches (deleted principals)")

			// Strict validation for match counts
			// Expected: 4 orphaned SID matches (invusr11760105113 x2, invusr21760105113, invgrp11760105113)
			// Expected: 4 valid principal matches (invaliduser1 x2, invaliduser2, invalidgroup1)
			Expect(len(orphanedMatches)).To(Equal(4), "Expected exactly 4 orphaned SID matches")
			Expect(len(validMatches)).To(Equal(4), "Expected exactly 4 valid principal matches")
			Expect(len(mismatches)).To(Equal(0), "Expected zero mismatches - all permissions should match by SID")

			LogDebug("SID-based verification complete: Valid principals and orphaned SIDs both preserved correctly")
			LogDebug(fmt.Sprintf("Strict validation passed: %d valid matches, %d orphaned matches, %d mismatches",
				len(validMatches), len(orphanedMatches), len(mismatches)))

			By("TC-SMB-NO-SID-MAPPING: Test completed!")
			By("########################## TC-SMB-NO-SID-MAPPING end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")

			// Recreate the invalid users/groups that were deleted during the test
			// This ensures the AD is in a clean state for subsequent tests
			invalidUsers := []string{"rootdomain\\invusr11760105113", "rootdomain\\invusr21760105113"}
			invalidGroups := []string{"rootdomain\\invgrp11760105113"}

			By("Recreating deleted AD principals for cleanup")
			err := CreateADPrincipals(invalidUsers, invalidGroups[0])
			if err != nil {
				LogDebug(fmt.Sprintf("Warning: Could not recreate AD principals: %v", err))
			} else {
				LogDebug("Successfully recreated AD principals")
			}

			err = StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred())

			err = ClearVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred())

			err = ClearVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred())

			err = CleanupTestEnv()
			Expect(err).To(BeNil())
			LogDebug("Cleanup complete.")
		})
	})
})
