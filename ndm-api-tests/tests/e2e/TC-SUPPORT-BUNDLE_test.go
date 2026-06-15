package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Support Bundle Test e2e", func() {
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		workerId2             string
		workerIds             []string
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		sourceVolumePath1     string
		sourceVolumePath2     string
		testStartTime         time.Time

		// Volume cloning - using standard approach
		clonedSourceVolumes []string
		clonedDestVolumes   []string
		sourceVolumeManager *TestVolumeManager
		destVolumeManager   *TestVolumeManager
	)

	Context("SUPPORT BUNDLE E2E", Ordered, func() {

		BeforeAll(func() {
			testStartTime = time.Now()
			var err error
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeAll] Using Project: %s (ID: %s)", ProjectName, ProjectId))
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
				LogDebug(fmt.Sprintf("[DeferCleanup] Cleaning up volumes for Project: %s (ID: %s)", ProjectName, ProjectId))
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})

			// Set volume paths using THIS test's cloned volumes
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])
			sourceVolumePath2 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[1], clonedSourceVolumes[1])
		})

		It("TC-001: Create a fileserver with 2 workers and check discovery and migration for support bundle", func() {
			By("########################## START-TC-SUPPORT-BUNDLE ################################")
			var sourceConfigID, sourcePathID1, sourcePathID2 string
			var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
			var destinationConfigID, destinationPathID1, destinationPathID2 string
			var resp *http.Response
			var err error

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			Wait(20)
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-support-bundle-%s-src-fs-%s", protocol, uniqueID),
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

			if NeedsGCNVManualUpload() {
				sourceConfigID, err = CreateSourceFileServerForGCNV(sourceParams, []string{clonedSourceVolumes[0], clonedSourceVolumes[1]}, headers)
				Expect(err).NotTo(HaveOccurred(), "Error creating GCNV source file server")
			} else {
				var resp *http.Response
				sourceConfigID, resp, err = CreateFileServer(sourceParams, headers)
				Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			}
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")

			By("Getting the source file server by config ID")
			if NeedsGCNVManualUpload() {
				sourcePathID1, err = GetSourcePathIDForGCNV(clonedSourceVolumes[0], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				sourcePathID2, err = GetSourcePathIDForGCNV(clonedSourceVolumes[1], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			} else {
				sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			}

			By("Creating a new discovery job for the source")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "*/.snapshot",
				PreserveAccessTime:       false,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
			Expect(len(sourceJobConfigIDs)).To(BeNumerically(">", 0), "No valid sourceJobConfigIDs found in response")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting jobs by jobConfigId for source")
			for _, sourceJobConfigID := range sourceJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()

				sourceDiscoveryJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")

				// Wait for discovery jobs to complete
				err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", sourceDiscoveryJobRunID)
			}

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-support-bundle-%s-dest-fs-%s", protocol, uniqueID),
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

			if NeedsGCNVManualUpload() {
				destinationConfigID, err = CreateSourceFileServerForGCNV(destinationParams, []string{clonedDestVolumes[0], clonedDestVolumes[1]}, headers)
				Expect(err).NotTo(HaveOccurred(), "Error creating GCNV destination file server")
			} else {
				destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
				Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			}
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")

			By("Getting the destination file server by configId")
			if NeedsGCNVManualUpload() {
				destinationPathID1, err = GetSourcePathIDForGCNV(clonedDestVolumes[0], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				destinationPathID2, err = GetSourcePathIDForGCNV(clonedDestVolumes[1], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			} else {
				destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
				destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
			}

			By("Creating a new discovery job for destination")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
				ExcludeOlderThan:         nil,
				ExcludeFilePatterns:      "*/.snapshot",
				PreserveAccessTime:       false,
				FirstRunAt:               GetCurrentUTCTimestamp(),
				CreatedBy:                nil,
				WorkflowExecutionTimeout: "60s",
				WorkflowTaskTimeout:      "30s",
				WorkflowRunTimeout:       "30s",
				StartDelay:               "10s",
			}
			destinationJobConfigIDs, resp, err = CreateDiscoveryJob(destinationJobParams, headers)

			Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
			Expect(len(destinationJobConfigIDs)).To(BeNumerically(">", 0), "No valid destinationJobConfigIDs found in response")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

			By("Getting jobs by jobConfigId for destination")
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

			By("Creating a migration job")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
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
			Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "Expected at least one jobConfigID")
			// Get migration job run IDs and wait for completion
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
			}

			By("Adding Delta Data")
			_, err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)
			_, err = AddDataToVolume(sourceVolumePath2)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath2)

			By("Creating bulk cutover job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
				DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
			Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")

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

			By("Approving bulk cutover job")
			for _, cutoverRunID := range cutoverRunIDs {
				resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
				Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverRunID)
				defer resp.Body.Close()
			}
		})

		It("Should generate, download, and verify all control-plane service logs in the support bundle", func() {
			By("Triggering support bundle generation")
			Expect(GenerateSupportBundle(ProjectId, workerId1, workerId2)).To(Succeed(), "Support bundle generation failed")

			By("Waiting for support bundle generation to complete")
			Wait(10) // Adjust as needed for your environment

			By("Downloading the support bundle zip")
			Expect(DownloadSupportBundleZip()).To(Succeed(), "Support bundle download failed")

			zipPath := "ndm_logs.zip"
			extractDir := "unzipped"
			LogDebug(fmt.Sprintf("Zip file path: %s\nExtraction directory: %s", zipPath, extractDir))

			By("Unzipping the support bundle")
			Expect(os.MkdirAll(extractDir, os.ModePerm)).To(Succeed(), "Error creating extraction directory")
			Wait(2) // Optional: wait for filesystem sync
			Expect(Unzip(zipPath, extractDir)).To(Succeed(), "Unzip error")

			today := time.Now().Format("2006-01-02")
			logFiles := []string{
				"admin-service.log",
				"config-service.log",
				"datamigrator-ui.log",
				"jobs-service.log",
				"reports-service.log",
			}
			LogDebug(fmt.Sprintf("Log files to check: %s", strings.Join(logFiles, ", ")))

			for _, logFile := range logFiles {
				logPath := fmt.Sprintf("ndm_logs/%s/%s/control-plane/%s", ProjectId, today, logFile)
				err := CheckLogFileExistsAndNotEmpty(extractDir, logPath)
				if err != nil && strings.Contains(err.Error(), "log file does not exist") {
					LogDebug(fmt.Sprintf("Skipping %s: file does not exist", logFile))
					continue
				}
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("%s: %v", logFile, err))
				LogDebug(fmt.Sprintf("%s: .log file exists with content", logFile))
			}

			By("Cleaning up the extraction directory and zip file")
			Expect(os.RemoveAll(extractDir)).To(Succeed(), "Error deleting extraction directory")
			Expect(os.Remove(zipPath)).To(Succeed(), "Error deleting zip file")
		})

		It("Should generate, download, and verify worker service logs folder is there in support bundle", func() {
			By("Triggering support bundle generation")
			Expect(GenerateSupportBundle(ProjectId, workerId1, workerId2)).To(Succeed(), "Support bundle generation failed")

			By("Waiting for support bundle generation to complete")
			Wait(10) // Adjust as needed for your environment

			By("Downloading the support bundle zip")
			Expect(DownloadSupportBundleZip()).To(Succeed(), "Support bundle download failed")

			zipPath := "ndm_logs.zip"
			extractDir := "unzipped"
			LogDebug(fmt.Sprintf("Zip file path: %s\nExtraction directory: %s", zipPath, extractDir))

			By("Unzipping the support bundle")
			Expect(os.MkdirAll(extractDir, os.ModePerm)).To(Succeed(), "Error creating extraction directory")
			Wait(2) // Optional: wait for filesystem sync
			Expect(Unzip(zipPath, extractDir)).To(Succeed(), "Unzip error")

			today := time.Now().Format("2006-01-02")

			By("Checking that at least 1 worker service log folder exists")
			baseDir := extractDir
			err := CheckAtLeastTwoWorkerFolders(baseDir, today, ProjectId)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Worker folder check failed: %v", err))

			By("Cleaning up the extraction directory and zip file")
			Expect(os.RemoveAll(extractDir)).To(Succeed(), "Error deleting extraction directory")
			Expect(os.Remove(zipPath)).To(Succeed(), "Error deleting zip file")
		})

		AfterAll(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)

			LogDebug(fmt.Sprintf("[TC-SUPPORT-BUNDLE END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-SUPPORT-BUNDLE DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
			By("########################## START-TC-SUPPORT-BUNDLE END ################################")
		})
	})
})
