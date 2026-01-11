package tests

import (
	"encoding/base64"
	"fmt"
	. "ndm-api-tests/utils"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// just create empty volume one for src and one for dest
var _ = Describe("TC-SMB-PERMISSIONS-002: Test SMB permissions with and without SID mapping", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB permissions is skipped in CI/CD as it is not supported in NFS")
		}
	})
	var (
		ProjectId              string
		ProjectName            string
		workerId1              string
		workerIds              []string
		err                    error
		destinationVolumePath1 string
		sourceVolumePath1      string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
		clonedSourceVolumes    []string
		clonedDestVolumes      []string
		sourceVolumeManager    *TestVolumeManager
		destVolumeManager      *TestVolumeManager
		testStartTime          time.Time
	)

	Context("SMB Permissions Migration With and Without SID Mapping Test", func() {
		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()

			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least 1 worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Setup ONTAP volume cloning for parallel test execution
			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}

			// Guarantee cleanup even on manual interrupt (Ctrl+C)
			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})

			// Set volume paths using cloned volumes (index 3 for source, index 2 for dest)
			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[2], clonedDestVolumes[2])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[3], clonedSourceVolumes[3])
		})

		It("TC-SMB-SID-MAPPING: Should apply SID mappings from CSV during migration", func() {
			testStartTime = time.Now()
			By("########################## TC-SMB-SID-MAPPING start ################################")
			LogDebug(fmt.Sprintf("[TC-SMB-SID-MAPPING START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))
			var sourceConfigID, sourcePathID1 string
			var destinationConfigID, destinationPathID1 string
			var migrationJobConfigIDs []string

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]

			By("Verifying domain credentials are available")
			domainUser := PROTOCOL_USERNAME
			if domainUser == "" {
				Skip("AZURE_SMB_PROTOCOL_USERNAME not set - cannot join domain. Set this environment variable to run AD tests.")
			}

			domainPassword := PROTOCOL_PASSWORD
			if domainPassword == "" {
				Skip("AZURE_SMB_PROTOCOL_PASSWORD not set - cannot join domain. Set this environment variable to run AD tests.")
			}

			By("Installing Active Directory PowerShell module on Windows worker")
			err = InstallADPowerShellModule()
			Expect(err).NotTo(HaveOccurred(), "Error installing AD PowerShell module")
			LogDebug("AD PowerShell module installed successfully")

			Wait(5)

			// By("Clearing all SMB sessions and Windows caches BEFORE creating files")
			// err = ClearAllSMBSessions()
			// Expect(err).NotTo(HaveOccurred(), "Error clearing SMB sessions before file creation")
			// LogDebug("All cache cleared")

			// Wait(10)

			// Define test principals based on AD users
			// Scenario 1: Orphaned SID mapping (deleted user → existing destination user)
			sourceOrphanedUser := "rootdomain\\invusr11760105113" // Will be deleted, SID: S-1-5-21-...-1276
			targetOrphanedUser := "invaliduser1"                  // Exists at destination, SID: S-1-5-21-...-1195
			targetOrphanedSID := "S-1-5-21-142954655-3166001488-1321770916-1195"

			// Scenario 2: Name-based mapping (existing user → different user by name match)
			sourceNameUser := "rootdomain\\invaliduser123456789" // Exists, SID: S-1-5-21-...-1176
			targetNameUser := "invaliduser123456"                // Maps to different user, SID: S-1-5-21-...-1175
			targetNameSID := "S-1-5-21-142954655-3166001488-1321770916-1175"

			// Scenario 3: Unmapped VALID user (proves only name-based mapping works, not SID-based)
			unmappedValidUser := "rootdomain\\invalidgroup1"                        // Valid user in AD, SID NOT in CSV
			unmappedValidUserSID := "S-1-5-21-142954655-3166001488-1321770916-1197" // Expected to stay unchanged

			By("Principal configuration summary")
			LogDebug("Scenario 1 - Orphaned SID Mapping:")
			LogDebug(fmt.Sprintf("  Source (will be deleted): %s", sourceOrphanedUser))
			LogDebug(fmt.Sprintf("  Target (maps to): %s (SID: %s)", targetOrphanedUser, targetOrphanedSID))
			LogDebug("Scenario 2 - Name-based Mapping:")
			LogDebug(fmt.Sprintf("  Source: %s", sourceNameUser))
			LogDebug(fmt.Sprintf("  Target (maps to): %s (SID: %s)", targetNameUser, targetNameSID))
			LogDebug("Scenario 3 - Unmapped VALID User (verifies SID-based mapping does NOT work):")
			LogDebug(fmt.Sprintf("  User: %s (SID: %s)", unmappedValidUser, unmappedValidUserSID))
			LogDebug("  Expected: Should remain UNCHANGED (proves only name-based mapping works, not automatic SID mapping)")

			By("Creating source SMB file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-smb-src-perm-002-sid-mapping-%s", uniqueID),
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
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[3], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting source export path")
			LogDebug(fmt.Sprintf("Source export path ID: %s", sourcePathID1))

			Wait(3)

			By("Creating test files with permissions for all three scenarios")
			// Create AD users first (required for icacls to work properly)
			testADUsers := []string{sourceOrphanedUser, sourceNameUser, unmappedValidUser}
			err = CreateADPrincipals(testADUsers, "") // No group needed
			Expect(err).NotTo(HaveOccurred(), "Error creating AD test users before file creation")
			LogDebug("Successfully created AD test users for file permissions")

			// Clear SMB cache so Windows can see the newly created users
			Wait(3)
			// By("Clearing SMB cache after AD user creation")
			// err = ClearAllSMBSessions()
			// Expect(err).NotTo(HaveOccurred(), "Error clearing SMB sessions after user creation")
			// LogDebug("SMB cache cleared, Windows should now recognize new users")

			By("Waiting for AD replication and Windows name resolution")
			Wait(60) // Extended wait time for Windows to fully recognize the AD users for SMB operations

			By("Creating test files with permissions for all three scenarios")
			testUsers := []string{sourceOrphanedUser, sourceNameUser, unmappedValidUser}
			err = CreateSMBFilesForSIDMapping(sourceVolumePath1, testUsers)
			Expect(err).NotTo(HaveOccurred(), "Error creating test files with permissions")
			LogDebug("Test files created with user permissions applied")

			By("Waiting for SMB to refresh permissions cache")
			Wait(15) // Allow SMB layer time to recognize newly applied permissions
			By("Capturing source permissions BEFORE deletion")
			sourcePermsBeforeDeletion, err := GetSMBPermissionsWithSID(sourceVolumePath1)
			LogDebug("=== SOURCE PERMISSIONS (BEFORE DELETION) ===")
			LogDebug(fmt.Sprintf("Looking for user: %s (username part: %s)", sourceOrphanedUser, strings.Split(sourceOrphanedUser, "\\")[1]))
			sourceOrphanedSID := ""
			for _, perm := range sourcePermsBeforeDeletion {
				LogDebug(fmt.Sprintf("File: %s", perm.FilePath))
				isScenario1File := strings.Contains(perm.FilePath, "scenario1_orphaned")
				if isScenario1File {
					LogDebug("  ^^^ This is a scenario1_orphaned file ^^^")
				}
				for _, acl := range perm.ACLEntries {
					LogDebug(fmt.Sprintf("  - Name: %s, SID: %s, ExistsInAD: %v, Perms: %s",
						acl.DisplayName, acl.SID, acl.ExistsInAD, acl.Permissions))

					// Get actual SID from file to use in CSV mapping
					usernameToFind := strings.ToLower(strings.Split(sourceOrphanedUser, "\\")[1])
					displayNameLower := strings.ToLower(acl.DisplayName)
					if strings.Contains(perm.FilePath, "scenario1_orphaned") &&
						strings.Contains(displayNameLower, usernameToFind) &&
						strings.HasPrefix(acl.SID, "S-1-5-21-") {
						sourceOrphanedSID = acl.SID
						LogDebug(fmt.Sprintf("*** MATCH FOUND! SID: %s (from user %s on file %s)", sourceOrphanedSID, acl.DisplayName, perm.FilePath))
					} else if isScenario1File && strings.HasPrefix(acl.SID, "S-1-5-21-") {
						LogDebug(fmt.Sprintf("    NO MATCH: displayName='%s' does not contain '%s'", displayNameLower, usernameToFind))
					}
				}
			}

			// Validate we found the SID before creating CSV
			Expect(sourceOrphanedSID).NotTo(BeEmpty(), fmt.Sprintf("Failed to find source orphaned SID for user %s in scenario1_orphaned files", sourceOrphanedUser))
			LogDebug(fmt.Sprintf("Using source orphaned SID: %s", sourceOrphanedSID))

			By("Creating SID mapping CSV")
			csvLines := []string{
				"sid_source,sid_target",
				fmt.Sprintf("%s,rootdomain\\invaliduser1", sourceOrphanedSID),
				"rootdomain\\invaliduser123456789,rootdomain\\invaliduser123456",
			}
			csvContent := strings.Join(csvLines, "\n")
			LogDebug("SID Mapping CSV Content:\n" + csvContent)
			base64Data := base64.StdEncoding.EncodeToString([]byte(csvContent))
			sidMappingBase64 := fmt.Sprintf("data:text/csv;base64,%s", base64Data)

			By("DELETING source orphaned user from Active Directory (Scenario 1)")
			By("This simulates a user that exists in source domain but not in destination domain")
			err = DeleteADPrincipals([]string{sourceOrphanedUser}, []string{})
			Expect(err).NotTo(HaveOccurred(), "Error deleting orphaned user from AD")
			LogDebug(fmt.Sprintf("Deleted from AD: %s (creates orphaned SID)", sourceOrphanedUser))

			// By("Clearing all SMB sessions and Windows name caches")
			// err = ClearAllSMBSessions()
			// Expect(err).NotTo(HaveOccurred(), "Error clearing SMB sessions")
			// LogDebug("SMB sessions cleared - forcing fresh connections")

			By("Waiting for AD deletion to propagate")
			Wait(180)

			By("Re-reading source permissions AFTER deletion")
			sourcePermsAfterDeletion, err := GetSMBPermissionsWithSID(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error re-reading source permissions")

			LogDebug("=== SOURCE PERMISSIONS (AFTER DELETION) ===")
			orphanedCount := 0
			for _, perm := range sourcePermsAfterDeletion {
				for _, acl := range perm.ACLEntries {
					if acl.IsOrphaned && strings.HasPrefix(acl.SID, "S-1-5-21-") {
						orphanedCount++
						LogDebug(fmt.Sprintf("Orphaned SID found: %s on file %s", acl.SID, perm.FilePath))
					}
				}
			}
			Expect(orphanedCount).To(BeNumerically(">", 0), "Expected to find orphaned SID after deletion")
			LogDebug(fmt.Sprintf("Found %d orphaned SID(s) - ready for SID mapping", orphanedCount))

			By("Creating destination SMB file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-smb-dst-perm-002-sid-mapping-%s", uniqueID),
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
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[2], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred())

			Wait(5)
			LogDebug(fmt.Sprintf("Base64 encoded CSV with SID mappings %s", sidMappingBase64))
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         sidMappingBase64,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}

			By("Creating a migration job WITH SID mapping CSV")
			LogDebug("Migration will use SID mapping CSV for cross-domain user resolution")
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

			By("Verifying SID Mapping Results at Destination")
			By("SCENARIO 1 (Orphaned SID): Source orphaned SID should be MAPPED to targetOrphanedSID")
			By("SCENARIO 2 (Name-based): Source invaliduser123456789 should be MAPPED to targetNameUser (invaliduser123456)")
			By("SCENARIO 3 (Unmapped Valid User): Source valid user NOT in CSV should remain AS-IS with ORIGINAL SID (proves no automatic SID mapping)")

			// Verification approach:
			// 1. Find the file with orphaned user permissions (scenario1_orphaned)
			// 2. Check that its ACL contains the TARGET SID (targetOrphanedSID) from CSV mapping
			// 3. Find the file with name-based mapping (scenario2_name_mapping)
			// 4. Check that its ACL contains the TARGET SID (targetNameSID) from CSV mapping
			// 5. Find the file with unmapped user (scenario3_unmapped)
			// 6. Check that its ACL contains the ORIGINAL user SID (no mapping)

			scenario1Verified := false
			scenario2Verified := false
			scenario3Verified := false

			LogDebug("\n=== VERIFYING SID MAPPING SCENARIOS ===")

			for _, perm := range destPermsWithSID {
				filePath := perm.FilePath

				// SCENARIO 1: Orphaned SID mapping
				if strings.Contains(filePath, "scenario1_orphaned") && strings.Contains(filePath, "orphaned_user_file.txt") {
					LogDebug(fmt.Sprintf("Checking SCENARIO 1 file: %s", filePath))
					for _, acl := range perm.ACLEntries {
						LogDebug(fmt.Sprintf("ACL: Name=%s, SID=%s", acl.DisplayName, acl.SID))
						if acl.SID == targetOrphanedSID {
							LogDebug(fmt.Sprintf("SCENARIO 1 PASS: Orphaned SID mapped correctly to %s (SID: %s)", targetOrphanedUser, targetOrphanedSID))
							scenario1Verified = true
						}
					}
				}

				// SCENARIO 2: Name-based mapping
				if strings.Contains(filePath, "scenario2_name_mapping") && strings.Contains(filePath, "name_mapping_file.txt") {
					LogDebug(fmt.Sprintf("Checking SCENARIO 2 file: %s", filePath))
					for _, acl := range perm.ACLEntries {
						LogDebug(fmt.Sprintf("ACL: Name=%s, SID=%s", acl.DisplayName, acl.SID))
						if acl.SID == targetNameSID {
							LogDebug(fmt.Sprintf("SCENARIO 2 PASS: Name-based mapping applied correctly to %s (SID: %s)", targetNameUser, targetNameSID))
							scenario2Verified = true
						}
					}
				}

				// SCENARIO 3: Unmapped valid user (verifies SID-based mapping does NOT work)
				if strings.Contains(filePath, "scenario3_unmapped") && strings.Contains(filePath, "unmapped_user_file.txt") {
					LogDebug(fmt.Sprintf("Checking SCENARIO 3 file: %s", filePath))
					for _, acl := range perm.ACLEntries {
						LogDebug(fmt.Sprintf("  ACL: Name=%s, SID=%s", acl.DisplayName, acl.SID))
						// For unmapped valid user, check that the ORIGINAL SID is preserved (no automatic SID mapping)
						if acl.SID == unmappedValidUserSID {
							LogDebug(fmt.Sprintf("SCENARIO 3 PASS: Unmapped valid user preserved with original SID: %s (SID: %s)", acl.DisplayName, acl.SID))
							LogDebug("This proves SID-based mapping does NOT work - only name-based mapping in CSV is applied")
							scenario3Verified = true
						}
					}
				}
			}

			// Strict validation: All three scenarios must pass
			Expect(scenario2Verified).To(BeTrue(), "SCENARIO 2 FAILED: Name-based mapping did not apply to target SID %s", targetNameSID)
			Expect(scenario1Verified).To(BeTrue(), "SCENARIO 1 FAILED: Orphaned SID was not mapped to target SID %s", targetOrphanedSID)
			Expect(scenario3Verified).To(BeTrue(), "SCENARIO 3 FAILED: Unmapped valid user SID was not preserved (expected original SID %s)", unmappedValidUserSID)

			LogDebug("\n=== ALL SID MAPPING SCENARIOS VERIFIED ===")
			LogDebug("SCENARIO 1: Orphaned SID → Mapped to target user via CSV")
			LogDebug("SCENARIO 2: Name-based mapping → Applied correctly via CSV")
			LogDebug("SCENARIO 3: Unmapped valid user → Original SID preserved (proves only CSV name-based mapping works, not automatic SID mapping)")

			By("TC-SMB-SID-MAPPING-WITH-CSV: Test completed!")
			By("########################## TC-SMB-SID-MAPPING-WITH-CSV end ################################")
		})

		It("TC-SMB-NO-SID-MAPPING: Should handle valid/invalid principals without SID mapping during migration (TC-002 merged)", func() {
			testStartTime = time.Now()
			By("########################## TC-SMB-NO-SID-MAPPING start ################################")
			LogDebug(fmt.Sprintf("[TC-SMB-NO-SID-MAPPING START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))
			var sourceConfigID, sourcePathID1 string
			var destinationConfigID, destinationPathID1 string
			var migrationJobConfigIDs []string
			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			By("Ensuring Windows worker is joined to Active Directory domain")
			// domainName := "rootdomain.local"

			domainUser := PROTOCOL_USERNAME
			if domainUser == "" {
				Skip("AZURE_SMB_PROTOCOL_USERNAME not set - cannot join domain")
			}

			domainPassword := PROTOCOL_PASSWORD
			if domainPassword == "" {
				Skip("AZURE_SMB_PROTOCOL_PASSWORD not set - cannot join domain")
			}

			// LogDebug(fmt.Sprintf("Domain join parameters: domain=%s, user=%s", domainName, domainUser))
			// err = EnsureWindowsWorkerDomainJoined(domainName, domainUser, domainPassword)
			// Expect(err).NotTo(HaveOccurred(), "Error joining Windows worker to domain")
			// LogDebug("Windows worker is domain-joined and ready for AD operations")

			// Wait(10)

			By("Installing Active Directory PowerShell module on Windows worker")
			err = InstallADPowerShellModule()
			Expect(err).NotTo(HaveOccurred(), "Error installing AD PowerShell module")
			LogDebug("AD PowerShell module installed successfully")

			Wait(5)

			// Define test principals (UNIQUE to Test 2 - avoid parallel conflicts)
			validUsers := []string{"rootdomain\\invaliduser1", "rootdomain\\invaliduser2"}
			validGroups := []string{"rootdomain\\invalidgroup1"}
			invalidUsers := []string{"rootdomain\\nosidtest2inv1", "rootdomain\\nosidtest2inv2"}
			invalidGroups := []string{"rootdomain\\nosidtest2invgrp"}

			By("Principal configuration summary")
			LogDebug(fmt.Sprintf("Valid Users (remain in AD): %v", validUsers))
			LogDebug(fmt.Sprintf("Valid Groups (remain in AD): %v", validGroups))
			LogDebug(fmt.Sprintf("Invalid Users (will be DELETED): %v", invalidUsers))
			LogDebug(fmt.Sprintf("Invalid Groups (will be DELETED): %v", invalidGroups))

			By("Creating source SMB file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-smb-src-perm-002-noSid-mapping-%s", uniqueID),
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
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			By("Getting source export path ID")
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[3], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred())

			Wait(3)

			By("Creating ALL test principals in AD (both valid and invalid)")
			allTestUsers := append(validUsers, invalidUsers...)
			allTestGroupsStr := strings.Join(append(validGroups, invalidGroups...), ",")
			err = CreateADPrincipals(allTestUsers, allTestGroupsStr)
			Expect(err).NotTo(HaveOccurred(), "Error creating test principals in AD")
			LogDebug("All test principals created in AD")

			By("Waiting for AD principal creation to replicate")
			Wait(60) // Wait for AD to replicate before adding users to groups

			By("Adding invalid users to invalid group")
			err = AddUsersToADGroup(invalidUsers, invalidGroups[0])
			Expect(err).NotTo(HaveOccurred(), "Error adding users to group")
			LogDebug(fmt.Sprintf("Added users %v to group %s", invalidUsers, invalidGroups[0]))

			// By("Clearing SMB cache after AD principal creation")
			// err = ClearAllSMBSessions()
			// Expect(err).NotTo(HaveOccurred())

			By("Waiting for AD replication and Windows name resolution")
			Wait(120) // Increased wait to ensure AD principals are fully replicated

			By("Creating test files with valid and invalid principal permissions")
			err = CreateSMBFilesWithMixedPrincipals(sourceVolumePath1, validUsers, invalidUsers, validGroups, invalidGroups)
			Expect(err).NotTo(HaveOccurred())

			By("Waiting for SMB to refresh permissions cache")
			Wait(15)

			By("Capturing source permissions BEFORE deletion")
			sourcePermsWithSID, err := GetSMBPermissionsWithSID(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred())
			Expect(len(sourcePermsWithSID)).To(BeNumerically(">", 0))

			LogDebug("=== SOURCE PERMISSIONS (BEFORE DELETION) ===")
			for _, perm := range sourcePermsWithSID {
				LogDebug(fmt.Sprintf("File: %s", perm.FilePath))
				for _, acl := range perm.ACLEntries {
					LogDebug(fmt.Sprintf("  - Name: %s, SID: %s, ExistsInAD: %v", acl.DisplayName, acl.SID, acl.ExistsInAD))
				}
			}

			By("DELETING invalid principals from Active Directory")
			err = DeleteADPrincipals(invalidUsers, invalidGroups)
			Expect(err).NotTo(HaveOccurred())
			LogDebug("Invalid principals deleted - creating orphaned SIDs")

			// By("Clearing all SMB sessions")
			// err = ClearAllSMBSessions()
			// Expect(err).NotTo(HaveOccurred())

			By("Waiting for AD deletion to propagate")
			Wait(180)

			By("Re-reading source permissions AFTER deletion")
			sourcePermsAfterDeletion, err := GetSMBPermissionsWithSID(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred())

			// Pre-existing orphaned SIDs from master volume root (inherited to all cloned files)
			preExistingOrphanedSIDs := map[string]bool{
				"S-1-5-21-2038298172-1297133386-33333":   true,
				"S-1-5-21-2038298172-1297133386-11111-0": true,
				"S-1-5-21-2038298172-1297133386-22222-1": true,
			}

			LogDebug("=== COUNTING ORPHANED SIDs (with filtering) ===")
			orphanedSIDsInSource := 0
			validSIDsInSource := 0
			for _, perm := range sourcePermsAfterDeletion {
				for _, acl := range perm.ACLEntries {
					if acl.IsOrphaned && strings.HasPrefix(acl.SID, "S-1-5-21-") {
						// Exclude pre-existing inherited orphaned SIDs from master volume
						if preExistingOrphanedSIDs[acl.SID] {
							LogDebug(fmt.Sprintf("FILTERED (pre-existing): SID=%s, File=%s", acl.SID, perm.FilePath))
						} else {
							orphanedSIDsInSource++
							LogDebug(fmt.Sprintf("COUNTED orphaned #%d: SID=%s, Name=%s, File=%s", orphanedSIDsInSource, acl.SID, acl.DisplayName, perm.FilePath))
						}
					} else if acl.ExistsInAD && strings.HasPrefix(acl.SID, "S-1-5-21-") {
						validSIDsInSource++
						LogDebug(fmt.Sprintf("COUNTED valid #%d: SID=%s, Name=%s, File=%s", validSIDsInSource, acl.SID, acl.DisplayName, perm.FilePath))
					}
				}
			}
			LogDebug(fmt.Sprintf("FINAL COUNT: %d orphaned (test users), %d valid", orphanedSIDsInSource, validSIDsInSource))

			Expect(orphanedSIDsInSource).To(Equal(4), "Expected 4 orphaned SIDs from deleted test users")
			Expect(validSIDsInSource).To(Equal(4), "Expected 4 valid SIDs")

			By("Creating destination SMB file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-smb-dst-perm-002-noSid-mapping-%s", uniqueID),
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

			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[2], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred())

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

			By("Creating migration job WITHOUT SID mapping")
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			migrationJobConfigID := migrationJobConfigIDs[0]
			getMigrationJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			migrationJobRunID := getMigrationJobsResp.JobRuns[0].JobRunId
			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred())

			Wait(15)

			By("Capturing destination permissions")
			destPermsWithSID, err := GetSMBPermissionsWithSID(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred())

			By("Comparing source and destination permissions BY SID")
			validMatches, orphanedMatches, mismatches, err := CompareSMBPermissionsBySID(sourcePermsAfterDeletion, destPermsWithSID)

			Expect(err).To(BeNil())
			Expect(len(orphanedMatches)).To(Equal(4), "Expected 4 orphaned SID matches")
			Expect(len(validMatches)).To(Equal(4), "Expected 4 valid principal matches")
			Expect(len(mismatches)).To(Equal(0), "Expected zero mismatches")

			LogDebug(fmt.Sprintf("Validation passed: %d valid, %d orphaned, %d mismatches", len(validMatches), len(orphanedMatches), len(mismatches)))

			By("TC-SMB-NO-SID-MAPPING: Test completed!")
			By("########################## TC-SMB-NO-SID-MAPPING end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)

			if PROTOCOL_TYPE == ProtocolNFS {
				LogDebug("Skipping cleanup as test was skipped for NFS protocol")
				return
			}


			// Cleanup ONTAP cloned volumes (this removes all test data)
			err = CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}

			LogDebug("Cleanup completed")
			LogDebug(fmt.Sprintf("[TC-SMB-PERMISSIONS-002-003 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-SMB-PERMISSIONS-002-003 DURATION] Total test duration: %s", testDuration))
		})
	})
})
