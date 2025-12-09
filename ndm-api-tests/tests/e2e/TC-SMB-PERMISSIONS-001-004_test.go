package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-SMB-PERMISSIONS-001-004: Test SMB default/explicit permissions and inheritance flags preservation during migration", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("SMB permissions is skipped in CI/CD as it is not supported in NFS")
		}
	})
	var (
		ProjectId              string
		workerId1              string
		err                    error
		destinationVolumePath1 string
		sourceVolumePath1      string
		headers                map[string]string
		attachedWorkersConfig  map[string]SSHConfig
	)

	Context("SMB Permissions Migration Test", func() {
		BeforeEach(func() {
			numberOfWorker := 1

			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)

			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
			workerIds := GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[2], DESTINATION_VOLUMES[2])
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[3], SOURCE_VOLUMES[3])
		})

		It("TC-SMB-PERMISSIONS-001-004: Should preserve file permissions and inheritance flags during SMB migration", func() {
			By("########################## TC-SMB-PERMISSIONS-001-004 start ################################")

			// MERGED TEST: TC-001 + TC-004
			// This test validates BOTH:
			//   1. Default vs Explicit permissions preservation (original TC-001)
			//   2. Inheritance flags preservation (original TC-004)
			// Both use PowerShell Get-Acl with JSON output for robust ACL reading
			// The PowerShell approach provides:
			//   - Structured JSON output (no fragile icacls parsing)
			//   - Direct access to FileSystemRights, InheritanceFlags, PropagationFlags
			//   - Better accuracy for complex ACL structures
			//   - Works over SSH from macOS to Windows workers
			// See: utils/permissions_manager.go for implementation details
			LogDebug("Using PowerShell Get-Acl with JSON output for ACL reading (SSH from macOS to Windows)")

			var sourceConfigID, sourcePathID1 string
			var destinationConfigID, destinationPathID1 string
			var sourceJobConfigIDs, migrationJobConfigIDs []string

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
				Host:             SOURCE_HOST_IPs[3],
				Workers:          []string{workerId1},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source SMB file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			By("Getting the source file server export path ID")
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[3], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting source export path, err : %s", err))

			By("Creating files with DEFAULT inherited permissions on source SMB volume")
			err = CreateSMBFilesWithDefaultPermissions(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error creating files with default permissions on source volume %s", sourceVolumePath1)

			By("Waiting for default permission files to be created")
			Wait(10)

			By("Recording DEFAULT inherited permissions from source volume")
			// Uses PowerShell Get-Acl | ConvertTo-Json via SSH
			// Returns structured JSON with Principal, Rights, InheritanceFlags, PropagationFlags
			// Much more robust than parsing icacls string output
			defaultSourcePermissions, err := GetSMBFileDefaultPermissions(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error getting default permissions from source volume %s", sourceVolumePath1)
			Expect(len(defaultSourcePermissions)).To(BeNumerically(">", 0), "No default permissions were recorded from source volume")
			LogDebug(fmt.Sprintf("Captured %d files/directories with DEFAULT permissions", len(defaultSourcePermissions)))

			By("Creating comprehensive test structure with multiple permission levels on source SMB volume")
			err = CreateSMBFilesWithMultiplePermissions(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error creating files with multiple permissions on source volume %s", sourceVolumePath1)

			By("Creating comprehensive inheritance test structure on source SMB volume (TC-004 merged)")
			err = CreateSMBFilesWithInheritanceScenarios(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error creating inheritance test structure on source volume %s", sourceVolumePath1)

			By("Waiting for file creation and permission setup to complete")
			Wait(15)

			By("Listing directory contents to verify file creation")
			dirOutput, err := ListSMBDirectoryContents(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error listing SMB directory contents")
			LogDebug(fmt.Sprintf("SMB Directory Contents:\n%s", dirOutput))

			By("Recording comprehensive original permissions from source volume")
			// PowerShell Get-Acl provides:
			//   - Direct SID to principal name resolution
			//   - Exact FileSystemRights (FullControl, Modify, ReadAndExecute, etc.)
			//   - Accurate inheritance flag extraction (ContainerInherit, ObjectInherit, None)
			//   - PropagationFlags (InheritOnly, NoPropagateInherit, None)
			//   - Better error handling with structured JSON
			explicitSourcePermissions, err := GetSMBFilePermissionsComprehensive(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error getting original permissions from source volume")
			Expect(len(explicitSourcePermissions)).To(BeNumerically(">", 0), "No permissions were recorded from source volume")

			By("Recording inheritance permissions from source volume (TC-004 merged)")
			sourceInheritancePermissions, err := GetSMBPermissionsWithInheritanceDetails(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error getting inheritance permissions from source volume %s", sourceVolumePath1)
			Expect(len(sourceInheritancePermissions)).To(BeNumerically(">", 0), "No inheritance permissions were recorded from source volume")
			LogDebug(fmt.Sprintf("Captured %d files/directories with inheritance permissions", len(sourceInheritancePermissions)))

			By("Logging inheritance scenarios found in source")
			LogInheritanceScenarioSummary(sourceInheritancePermissions)

			By("Combining DEFAULT and EXPLICIT permissions for complete source inventory")
			// Merge both permission sets for comprehensive comparison
			allSourcePermissions := append(defaultSourcePermissions, explicitSourcePermissions...)
			LogDebug(fmt.Sprintf("Total source permissions captured: %d (Default: %d, Explicit: %d)",
				len(allSourcePermissions), len(defaultSourcePermissions), len(explicitSourcePermissions)))

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

			result, err := ValidateReport(sourceDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", "SMB-PERMISSIONS", "tc_01_discovery.json"))
			Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
			LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job : %s = %s", sourceDiscoveryJobRunID, result))

			By("Creating destination SMB file server")
			destinationParams := CreateServereParams{
				ConfigName:       "destination-smb-permissions-server",
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
			Expect(err).NotTo(HaveOccurred(), "Error creating destination SMB file server")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server export path ID")
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[2], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting destination export path, err : %s", err))

			By("Creating a migration job to migrate permissions")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         true,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}

			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "No migration job config IDs returned")
			defer resp.Body.Close()

			migrationJobConfigID := migrationJobConfigIDs[0]

			By("Waiting for migration job to complete")
			getMigrationJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run details")
			Expect(len(getMigrationJobsResp.JobRuns)).To(BeNumerically("==", 1), "No jobRuns found in response")
			defer resp.Body.Close()

			migrationJobRunID := getMigrationJobsResp.JobRuns[0].JobRunId
			Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete successfully")

			By("Validating migration job report")
			migrationResult, err := ValidateReport(migrationJobRunID, JobTypeMigration, "../../validators/SMB-PERMISSIONS/tc_01_migration.json")
			Expect(err).NotTo(HaveOccurred(), "Error while validating migration report")
			By(fmt.Sprintf("Migration report validation result: %s", migrationResult))

			By("Verifying comprehensive permissions were preserved on destination volume")
			Wait(15)

			By("Retrieving DEFAULT permissions from destination")
			// PowerShell Get-Acl with JSON output provides structured, parseable data
			// No more fragile regex-based icacls parsing!
			// See: utils/permissions_manager.go (parseSMBPermissions, convertPowerShellACLsToSMBPermissions)
			defaultDestinationPermissions, err := GetSMBFileDefaultPermissions(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error getting permissions from destination volume")
			Expect(len(defaultDestinationPermissions)).To(BeNumerically(">", 0), "No permissions found on destination volume")

			By("Waiting for SSH connection cleanup before next operation")
			Wait(5)

			By("Retrieving EXPLICIT permissions from destination")
			explicitDestinationPermissions, err := GetSMBFilePermissionsComprehensive(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error getting explicit permissions from destination volume")
			Expect(len(explicitDestinationPermissions)).To(BeNumerically(">", 0), "No explicit permissions found on destination volume")
			LogDebug(fmt.Sprintf("Retrieved %d files/directories with EXPLICIT permissions from destination", len(explicitDestinationPermissions)))

			By("Recording inheritance permissions from destination volume (TC-004 merged)")
			destinationInheritancePermissions, err := GetSMBPermissionsWithInheritanceDetails(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error getting inheritance permissions from destination volume %s", destinationVolumePath1)
			Expect(len(destinationInheritancePermissions)).To(BeNumerically(">", 0), "No inheritance permissions were recorded from destination volume")
			LogDebug(fmt.Sprintf("Captured %d files/directories with inheritance permissions from destination", len(destinationInheritancePermissions)))

			By("Combining destination permissions for complete comparison")
			allDestinationPermissions := append(defaultDestinationPermissions, explicitDestinationPermissions...)
			LogDebug(fmt.Sprintf("Total destination permissions retrieved: %d (Default: %d, Explicit: %d)",
				len(allDestinationPermissions), len(defaultDestinationPermissions), len(explicitDestinationPermissions)))

			By("Comparing comprehensive source and destination permissions")
			LogDebug(fmt.Sprintf("Comparing %d source permissions with %d destination permissions",
				len(allSourcePermissions), len(allDestinationPermissions)))

			// Log sample permissions for debugging
			if len(allSourcePermissions) > 0 {
				LogDebug(fmt.Sprintf("Sample source permission: %+v", allSourcePermissions[0]))
			}
			if len(allDestinationPermissions) > 0 {
				LogDebug(fmt.Sprintf("Sample destination permission: %+v", allDestinationPermissions[0]))
			}

			LogDebug("Starting DEFAULT permission comparison between source and destination")
			// CompareSMBPermissions() now works with PowerShell JSON-parsed ACL data
			// The comparison logic handles normalized ACL entries with proper inheritance matching
			// Benefits: No string parsing errors, accurate permission comparison, better debugging
			err = CompareSMBPermissions(defaultSourcePermissions, defaultDestinationPermissions)
			Expect(err).To(BeNil(), "Default SMB permissions were not properly preserved during migration: %v", err)

			LogDebug("Starting EXPLICIT permission comparison between source and destination")
			err = CompareSMBPermissions(explicitSourcePermissions, explicitDestinationPermissions)
			Expect(err).To(BeNil(), "Explicit SMB permissions were not properly preserved during migration: %v", err)

			By("Validating inheritance flag preservation (TC-004 merged)")
			err = CompareSMBPermissionsWithInheritanceValidation(sourceInheritancePermissions, destinationInheritancePermissions)
			Expect(err).To(BeNil(), "SMB permissions with inheritance were not properly preserved during migration: %v", err)
			LogDebug("Expected inheritance scenarios validated")

			LogDebug("SMB permissions comparison successful - all comprehensive permissions and inheritance flags preserved!")

			By("Creating discovery job on destination to verify file structure")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "",
				PreserveAccessTime:       false,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}

			destinationJobConfigIDs, resp, err := CreateDiscoveryJob(destinationJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating discovery job for destination")
			Expect(len(destinationJobConfigIDs)).To(BeNumerically(">", 0), "No valid destinationJobConfigIDs found in response")
			defer resp.Body.Close()

			destinationJobConfigID := destinationJobConfigIDs[0]

			By("Waiting for destination discovery job to complete")
			getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting destination discovery job run details")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			destinationDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
			Expect(destinationDiscoveryJobRunID).NotTo(BeEmpty(), "Destination Discovery JobRun ID should not be empty")

			err = WaitForJobState(destinationDiscoveryJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", destinationDiscoveryJobRunID)

			By("Validating discovery report for destination")
			result, err = ValidateReport(destinationDiscoveryJobRunID, JobTypeDiscovery, "../../validators/SMB-PERMISSIONS/tc_01_discovery.json")
			Expect(err).NotTo(HaveOccurred(), "Error validating discovery report for destination")
			By(fmt.Sprintf("Discovery report validation result: %s", result))

			By("########################## TC-SMB-PERMISSIONS-001-004 end ################################")
		})

		AfterEach(func() {
			if PROTOCOL_TYPE == ProtocolNFS {
				LogDebug("Skipping cleanup as test was skipped for NFS protocol")
				return
			}

			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")

			err = ClearVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error clearing source volume %s", sourceVolumePath1)

			err = ClearVolume(destinationVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error clearing destination volume %s", destinationVolumePath1)

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})
	})
})
