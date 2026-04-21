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

var _ = Describe("TC-001: Create a fileserver with 2 workers and check discovery and scheduled migration", func() {
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		sourceVolumePath1     string
		sourceVolumePath2     string
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
		testStartTime         time.Time
	)

	Context("TC-001", func() {
		BeforeEach(func() {
			testStartTime = time.Now()
			// Use globally created project and workers (created once in InitTestEnv)
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
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
			// Set volume paths using THIS test's cloned volumes
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], clonedSourceVolumes[1])
		})

		It("TC-001: Create a fileserver with 2 workers and check discovery and scheduled migration", func() {
			By("########################## TC-001 start ################################")
			LogDebug(fmt.Sprintf("[TC-001 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-001 It Block] Using Project: %s (ID: %s)", ProjectName, ProjectId))

			var sourceConfigID, sourcePathID1, sourcePathID2 string
			var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
			var destinationConfigID, destinationPathID1, destinationPathID2 string

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By(fmt.Sprintf("Creating Source File Server : %s", SOURCE_HOST_IPs[0]))
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-001-%s-src-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}

			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			By(fmt.Sprintf("Source file server created with config ID: %#v", resp))

			By("Getting the Source File Server Export Path ID")
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			LogDebug(fmt.Sprintf("Source File Server Export Path ID : [%s, %s]", sourcePathID1, sourcePathID2))

			By("Creating a Bulk Discovery Job for the Source File Server")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
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
			sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()

			discovery_validators := []string{
				"src_vol_discovery.json",
				"src_vol2_discovery.json",
			}
			for i, sourceJobConfigID := range sourceJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()

				sourceDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

				// Wait for discovery jobs to complete
				err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", sourceDiscoveryJobRunID)

				result, err := ValidateReport(sourceDiscoveryJobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error validating report for job %s", sourceDiscoveryJobRunID)
				LogDebug(fmt.Sprintf("Validate Report Result for Discovery Job : %s = %s", sourceDiscoveryJobRunID, result))
			}

			By(fmt.Sprintf("Creating Destination File Server : %s", DESTINATION_HOST_IPs[0]))
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-001-%s-dest-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting the Destination File Server Export Path ID")
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			LogDebug(fmt.Sprintf("Destination File Server Export Path ID : [%s, %s]", destinationPathID1, destinationPathID2))

			By("Creating a Bulk Discovery Job for the Destination File Server")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
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
			destinationJobConfigIDs, resp, err = CreateDiscoveryJob(destinationJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for destination: %v", err))
			defer resp.Body.Close()

			for _, destinationJobConfigID := range destinationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(destinationJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()
				destinationDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(destinationDiscoveryJobRunID).NotTo(BeEmpty(), "Destination Discovery JobRun ID should not be empty")

				// Wait for discovery jobs to complete
				err = WaitForJobState(destinationDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", destinationDiscoveryJobRunID)
			}

			By("Creating a Scheduled Bulk Migration Job")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetFutureUTCTimestamp(90),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			Wait(10)
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers, false)
				Expect(getJobsResp.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty")
				Expect(getJobsResp.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE")
				Expect(getJobsResp.JobType).To(Equal("MIGRATE"), "Expected jobType to be MIGRATE")
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			}

			Wait(80) // Waiting for the scheduled time to trigger migration jobs

			migration_validators := []string{
				"src_to_dest_vol_migration.json",
				"src2_to_dest2_vol_migration.json",
			}

			// Create volume replacement maps for dynamic validation
			// Map old hardcoded validator volume names to cloned volume names
			var volumeReplacementMaps []map[string]string
			if PROTOCOL_TYPE == "NFS" {
				volumeReplacementMaps = []map[string]string{
					{
						"vol_dnd_src_automation_1":  clonedSourceVolumes[0], // Old NFS source vol -> cloned name
						"vol_dnd_dest_automation_1": clonedDestVolumes[0],   // Old NFS dest vol -> cloned name
					},
					{
						"vol_dnd_src_automation_2":  clonedSourceVolumes[1], // Old NFS source vol -> cloned name
						"vol_dnd_dest_automation_2": clonedDestVolumes[1],   // Old NFS dest vol -> cloned name
					},
				}
			} else { // SMB
				volumeReplacementMaps = []map[string]string{
					{
						"volSMBAuto_vol1": clonedSourceVolumes[0], // Old SMB source vol -> cloned name
						"vol1":            clonedDestVolumes[0],   // Old SMB dest vol -> cloned name
					},
					{
						"vol4_33": clonedSourceVolumes[1], // Old SMB source vol -> cloned name
						"vol2":    clonedDestVolumes[1],   // Old SMB dest vol -> cloned name
					},
				}
			}

			// Get migration job run IDs and wait for completion
			for i, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

				result, err := ValidateReport(
					migrationJobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, migration_validators[i]),
					volumeReplacementMaps[i],
				)
				Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
				LogDebug(fmt.Sprintf("validate report result : %s", result))
			}

			By("Adding Delta Data to the Source Paths")
			_, err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			_, err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			By("Creating a Bulk Cutover Job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			By("Getting jobs by job config id")
			for _, jobConfigID := range jobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID for config %s", jobConfigID)
				defer resp.Body.Close()

				cutoverRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(cutoverRunID).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", cutoverRunID)

				WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)
				// Fetch the latest status
				getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", jobConfigID)
				defer resp.Body.Close()

				Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found for config %s", jobConfigID)
				Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", jobConfigID)
				Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected status BLOCKED for config %s", jobConfigID)

				cutoverRunIDs = append(cutoverRunIDs, cutoverRunID)
			}

			By("Approving Bulk Cutover Job")
			for _, cutoverRunID := range cutoverRunIDs {
				resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverRunID)
				defer resp.Body.Close()
			}

			// By("Validating cutover reports")
			// for _, cutoverRunID := range cutoverRunIDs {
			// 	result, err := ValidateReport(cutoverRunID, JobTypeCutover, fmt.Sprintf("../../validators/%s/cutover_validation.json", PROTOCOL_TYPE))
			// 	Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
			// 	LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
			// }

			By("########################## TC-001 end ################################")
		})

		It("should get versions ", func() {
			By("########################## About NDM START ################################")
			By("waiting 15 sec to set worker version on prometheus..")
			Wait(15)
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			abouNDMResp, err := GetVersions(headers)
			Expect(err).To(BeNil())
			// get versions using ssh
			cpVersion, err := GetCPVersion()
			Expect(err).To(BeNil())
			Expect(cpVersion).Should(Not(BeEmpty()), "Expect CP version but got empty")
			workerVersion, err := GetWorkerVersion()
			Expect(err).To(BeNil())
			Expect(workerVersion).Should(Not(BeEmpty()), "Expect Worker version but got empty")

			// Validate versions
			gotWorkerVersion := abouNDMResp.Data.Items.Build.WorkerVersion.Version
			Expect(workerVersion).To(Equal(gotWorkerVersion), "Expected Worker version")
			gotCPVersion := abouNDMResp.Data.Items.Build.ControlPlaneVersion.Version
			Expect(cpVersion).To(Equal(gotCPVersion), "Expected CP version")
			By("########################## About NDM END ################################")
		})

		It("TC-001 - DLM : Should test a small migration from a directory to the destination", func() {
			By("########################## TC-001 DLM start ################################")

			if MIGRATION_DIR == "" {
				Skip("MIGRATION_DIR not set, skipping DLM folder migration test")
			}

			var sourceConfigID string
			var sourcePathID string

			var destConfigID string
			var destPathID string
			var dlmJobConfigIDs []string

			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))
			username := PROTOCOL_USERNAME
			if PROTOCOL_TYPE == ProtocolSMB && strings.Contains(PROTOCOL_USERNAME, "\\") {
				username = strings.Split(PROTOCOL_USERNAME, "\\")[1]
			}

			// Step 1: Create source file server

			By(fmt.Sprintf("Creating Source File Server for DLM test: %s", SOURCE_HOST_IPs[0]))
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-001-dlm-%s-src-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         username,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			if PROTOCOL_TYPE == ProtocolSMB {
				sourceParams.AdServerIp = PROTOCOL_AD_SERVER_IP
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting the Source File Server Export Path ID")
			sourcePathID, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error getting source export path: %s", err))
			LogDebug(fmt.Sprintf("Source export path ID: %s", sourcePathID))

			// Step 2: Get the file server entity ID (distinct from config ID, required by jobs-service)
			By("Getting the file server entity ID for GetDirs")
			sourceEntityID, err := GetFileServerEntityID(sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting file server entity ID")
			LogDebug(fmt.Sprintf("Source file server entity ID: %s", sourceEntityID))

			// Step 3: Get the Directories in the first level
			By(fmt.Sprintf("Calling GetDirs and validating MIGRATION_DIR '%s' exists", MIGRATION_DIR))
			dirs, resp, err := GetDirs(GetDirsRequest{
				FileServerID: sourceEntityID,
				ExportPath:   "/" + clonedSourceVolumes[0],
			}, GetProjectIdHeader(AuthToken, ProjectId))
			Expect(err).NotTo(HaveOccurred(), "Error calling GetDirs")
			defer resp.Body.Close()
			Expect(dirs).NotTo(BeEmpty(), "GetDirs returned empty list — no directories found on source volume")

			LogDebug(fmt.Sprintf("Dirs: %v", dirs))

			// Step 4: Validate our Directory exists
			found := false
			for _, d := range dirs {
				if d.Name == MIGRATION_DIR {
					found = true
					break
				}
			}
			Expect(found).To(BeTrue(), fmt.Sprintf("MIGRATION_DIR '%s' not found in GetDirs response", MIGRATION_DIR))
			LogDebug(fmt.Sprintf("MIGRATION_DIR '%s' confirmed in GetDirs response", MIGRATION_DIR))

			// Step 4: Create destination file server and get export path
			By(fmt.Sprintf("Creating Destination File Server for DLM test: %s", DESTINATION_HOST_IPs[0]))
			destParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-001-dlm-%s-dest-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         username,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			if PROTOCOL_TYPE == ProtocolSMB {
				destParams.AdServerIp = PROTOCOL_AD_SERVER_IP
			}
			destConfigID, resp, err = CreateFileServer(destParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
			Expect(destConfigID).NotTo(BeEmpty(), "destConfigID is empty")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting the Destination File Server Export Path ID")
			destPathID, err = GetExportPathID("destination", clonedDestVolumes[0], destConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error getting destination export path: %s", err))
			LogDebug(fmt.Sprintf("Destination export path ID: %s", destPathID))

			// Step 5: Migrate source directory to root of destination volume.
			// correctly as: volume_path + sourceDirectoryPath + file_path.
			// Append '/' to the directory path just like the UI does.
			sourceDirPath := "/" + strings.TrimPrefix(MIGRATION_DIR, "/")
			By(fmt.Sprintf("Creating folder migration job: source dir '%s' → destination root", sourceDirPath))
			dlmJobConfigIDs, resp, err = CreateMigrationJob(MigrationJobParams{
				FirstRunAt:               GetCurrentUTCTimestamp(),
				FutureRunSchedule:        "",
				SourcePathIDs:            []string{sourcePathID},
				DestinationPathIDs:       []string{destPathID},
				SourceDirectoryPath:      sourceDirPath,
				DestinationDirectoryPath: "",
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/~snapshot/*,*/.snapshot/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "0-M",
				},
			}, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating DLM migration job")
			defer resp.Body.Close()

			By("Waiting for folder migration job to complete")
			for _, dlmJobConfigID := range dlmJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(dlmJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting DLM migration job run details")
				defer resp.Body.Close()
				dlmJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(dlmJobRunID).NotTo(BeEmpty(), "DLM migration job run ID is empty")
				err = WaitForJobState(dlmJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "DLM migration job did not complete")
				LogDebug(fmt.Sprintf("DLM migration job run ID: %s completed", dlmJobRunID))

				// Step 6: Validate the migration report.
				// JSON spec stores hardcoded base volume names; replacements map them to the
				// actual cloned names in the report (same pattern as the rest of TC-001).
				By("Validating DLM migration report against JSON spec")
				var volReplacements map[string]string
				if PROTOCOL_TYPE == "NFS" {
					volReplacements = map[string]string{
						"master_nfs_vol_dnd_src_automation_1":  clonedSourceVolumes[0],
						"master_nfs_vol_dnd_dest_automation_1": clonedDestVolumes[0],
					}
				} else { // SMB
					volReplacements = map[string]string{
						"master_smb_vol_dnd_src_automation_1":  clonedSourceVolumes[0],
						"master_smb_vol_dnd_dest_automation_1": clonedDestVolumes[0],
					}
				}
				result, err := ValidateReport(
					dlmJobRunID,
					JobTypeMigration,
					fmt.Sprintf("../../validators/%s/dlm_folder_migration.json", PROTOCOL_TYPE),
					volReplacements,
				)
				Expect(err).NotTo(HaveOccurred(), "Error validating DLM migration report")
				LogDebug(fmt.Sprintf("DLM migration report validation result: %v", result))
			}

			By("########################## TC-001 DLM end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)

			By("Cleanup started")
			LogDebug(fmt.Sprintf("[AfterEach] Cleaning up for Project: %s (ID: %s)", ProjectName, ProjectId))

			// Cleanup ONTAP cloned volumes (this removes all test data)
			err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}

			LogDebug("Cleanup completed")
			LogDebug(fmt.Sprintf("[TC-001 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-001 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})
