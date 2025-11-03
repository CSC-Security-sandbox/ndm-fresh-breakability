package tests

import (
    "encoding/base64"
    "fmt"
    . "ndm-api-tests/utils"
    "strings"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

var _ = Describe("TC-SMB-PERMISSIONS-SID-MAPPING: Test SMB permissions WITH SID mapping CSV", func() {
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

    Context("SMB Permissions Migration With SID Mapping CSV Test", func() {
        BeforeEach(func() {
            if PROTOCOL_TYPE != ProtocolSMB {
                Skip("Skipping SMB permissions test as protocol is not SMB")
            }

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

        It("TC-SMB-SID-MAPPING: Should apply SID mappings from CSV during migration", func() {
            By("########################## TC-SMB-SID-MAPPING start ################################")
            var sourceConfigID, sourcePathID1 string
            var destinationConfigID, destinationPathID1 string
            var sourceJobConfigIDs, migrationJobConfigIDs []string

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

            Wait(10)

            By("Installing Active Directory PowerShell module on Windows worker")
            err = InstallADPowerShellModule()
            Expect(err).NotTo(HaveOccurred(), "Error installing AD PowerShell module")
            LogDebug("AD PowerShell module installed successfully")

            Wait(5)

            By("Clearing all SMB sessions and Windows caches BEFORE creating files")
            err = ClearAllSMBSessions()
            Expect(err).NotTo(HaveOccurred(), "Error clearing SMB sessions before file creation")
            LogDebug("All cache cleared")

            Wait(10)

            // Define test principals based on AD users
            // Scenario 1: Orphaned SID mapping (deleted user → existing destination user)
            sourceOrphanedUser := "rootdomain\\invusr11760105113" // Will be deleted, SID: S-1-5-21-...-1276
            targetOrphanedUser := "invaliduser1"                  // Exists at destination, SID: S-1-5-21-...-1195
            targetOrphanedSID := "S-1-5-21-142954655-3166001488-1321770916-1195"

            // Scenario 2: Name-based mapping (existing user → different user by name match)
            sourceNameUser := "rootdomain\\invaliduser123456789" // Exists, SID: S-1-5-21-...-1176
            targetNameUser := "invaliduser123456"        // Maps to different user, SID: S-1-5-21-...-1175
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
                ConfigName:       "source-smb-sid-mapping",
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

            By("Creating test files with permissions for all three scenarios")
            // Create files with specific users for each scenario
            testUsers := []string{sourceOrphanedUser, sourceNameUser, unmappedValidUser}

            err = CreateSMBFilesForSIDMapping(sourceVolumePath1, testUsers)
            Expect(err).NotTo(HaveOccurred(), "Error creating files for SID mapping test")
            LogDebug("Created test files with user permissions for all scenarios")

            Wait(5)

            By("Capturing source permissions BEFORE deletion")
            sourcePermsBeforeDeletion, err := GetSMBPermissionsWithSID(sourceVolumePath1)
            Expect(err).NotTo(HaveOccurred(), "Error capturing source permissions")
            Expect(len(sourcePermsBeforeDeletion)).To(BeNumerically(">", 0))

            LogDebug("=== SOURCE PERMISSIONS (BEFORE DELETION) ===")
            sourceOrphanedSID := ""
            for _, perm := range sourcePermsBeforeDeletion {
                LogDebug(fmt.Sprintf("File: %s", perm.FilePath))
                for _, acl := range perm.ACLEntries {
                    LogDebug(fmt.Sprintf("  - Name: %s, SID: %s, ExistsInAD: %v, Perms: %s",
                        acl.DisplayName, acl.SID, acl.ExistsInAD, acl.Permissions))
                    
                    // Get actual SID from file to use in CSV mapping
                    if strings.Contains(perm.FilePath, "scenario1_orphaned") && 
                       strings.Contains(strings.ToLower(acl.DisplayName), strings.ToLower(strings.Split(sourceOrphanedUser, "\\")[1])) &&
                       strings.HasPrefix(acl.SID, "S-1-5-21-") {
                        sourceOrphanedSID = acl.SID
                    }
                }
            }

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

            By("Clearing all SMB sessions and Windows name caches")
            err = ClearAllSMBSessions()
            Expect(err).NotTo(HaveOccurred(), "Error clearing SMB sessions")
            LogDebug("SMB sessions cleared - forcing fresh connections")

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
            Expect(err).NotTo(HaveOccurred())
            defer resp.Body.Close()

            sourceJobConfigID := sourceJobConfigIDs[0]
            getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers)
            Expect(err).NotTo(HaveOccurred())
            defer resp.Body.Close()

            sourceDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
            err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN)
            Expect(err).NotTo(HaveOccurred())
            LogDebug(fmt.Sprintf("Source discovery: %s", sourceDiscoveryJobRunID))

            By("Creating destination SMB file server")
            destinationParams := CreateServereParams{
                ConfigName:       "dest-smb-sid-mapping",
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

            By("TC-SMB-SID-MAPPING: Test completed!")
            By("########################## TC-SMB-SID-MAPPING end ################################")
        })

        AfterEach(func() {
            By("Cleanup started")

            // Recreate the orphaned user that was deleted during the test
            // This ensures the AD is in a clean state for subsequent tests
            sourceOrphanedUser := "rootdomain\\invusr11760105113"

            By("Recreating deleted AD principal for cleanup")
            err := CreateADPrincipals([]string{sourceOrphanedUser}, "")
            if err != nil {
                LogDebug(fmt.Sprintf("Warning: Could not recreate AD principal: %v", err))
            } else {
                LogDebug(fmt.Sprintf("Successfully recreated AD principal: %s", sourceOrphanedUser))
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

