package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("GCNV Flex Test e2e", Ordered, func() {
	var (
		ProjectId             string
		workerId1             string
		workerId2             string
		workerIds             []string
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
	)

	BeforeAll(func() {
		var err error
		numberOfWorker := 2
		ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
		workerIds = GetWorkerIds()
		workerId1 = workerIds[0]
		workerId2 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)
	})

	AfterAll(func() {
		destinationVolumePath1 := fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, DESTINATION_VOLUMES[1])
		clearVolumeErr := ClearVolume(destinationVolumePath1)
		Expect(clearVolumeErr).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)

		LogDebug("Cleaning up test environment")
		cleanUpErr := CleanupTestEnv()
		Expect(cleanUpErr).To(BeNil(), "Error during test environment cleanup")
	})

	Context("Running jobs on file server with manual upload option", func() {
		var (
			SourceConfigID      string
			FileServerId        string
			DestinationConfigID string
		)
		It("Should create a file server with manual upload option", func() {
			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       "source_manual_upload_01",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IP,
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
				ExportPathSource: PtrExportPathSource(ManualUpload),
			}
			var err error
			var resp *http.Response
			SourceConfigID, resp, err = CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(SourceConfigID).NotTo(BeEmpty(), "SourceConfigID is empty")
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
			defer resp.Body.Close()
		})

		It("Should create a destination file server with auto upload option", func() {
			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       "destination_auto_upload",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IP,
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			var err error
			var resp *http.Response
			DestinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(DestinationConfigID).NotTo(BeEmpty(), "DestinationConfigID is empty")
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
			defer resp.Body.Close()
		})

		It("Should upload a path file to the file server", func() {
			By("Fetching the latest created file server")
			fileServer, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServer.FileServers)).To(BeNumerically("==", 1), "Expected exactly one file server to be returned")
			FileServerId = fileServer.FileServers[0].Id

			By("Uploading a path file with multiple paths to the file server")
			fileContent := FileContent{
				FileName: "test_multiple_paths_file.csv",
				FileSize: 2048,
				Contents: fmt.Sprintf("path\n%s\n%s", SOURCE_VOLUMES[0], SOURCE_VOLUMES[1]),
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
			Expect(err).NotTo(HaveOccurred(), "Error reuploading path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 2), "Expected two new paths to be uploaded")
			Expect(uploadStats.AlreadyExistingPaths).To(BeNumerically("==", 0), "Expected no already existing paths")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 0), "Expected no paths to be no longer available")
			Wait(10)

			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(20)

			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 2), "Expected two volumes to be present in the file server")

			By("Getting volume details for the valid path")
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[0])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validVolume.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")

			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", SOURCE_VOLUMES[1])
			Expect(invalidVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(invalidVolume.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")
		})

		It("Should run discovery job on the valid volume", func() {
			By("Running discovery job on the valid volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path '%s'", SOURCE_VOLUMES[1])

			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{validVolume.ID},
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
			sourceJobConfigIDs, resp, err := CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
			Expect(len(sourceJobConfigIDs)).To(BeNumerically(">", 0), "No valid sourceJobConfigIDs found in response")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
			Wait(15)

			By("Getting the job run details")
			jobConfigDetails, resp, err := GetJobRunDetails(sourceJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Expected jobRuns not to be empty for config %s", sourceJobConfigIDs[0])
			Expect(jobConfigDetails.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", sourceJobConfigIDs[0])
			Expect(jobConfigDetails.JobType).To(Equal("DISCOVER"), "Expected jobType to be DISCOVER for config %s", sourceJobConfigIDs[0])

			jobRunDetail := jobConfigDetails.JobRuns[0].JobRunId
			Expect(jobRunDetail).NotTo(BeEmpty(), "Source Discovery JobRun ID should not be empty")
			err = WaitForJobState(jobRunDetail, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", jobRunDetail)
		})

		It("Should run migration job on the valid volume", func() {
			By("Running migration job")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", SOURCE_VOLUMES[1])
			destinationPathID1, err := GetExportPathID("destination", DESTINATION_VOLUMES[1], DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{validVolume.ID},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
			Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "Expected at least one jobConfigID")
			Wait(15)

			By("Getting the job run details")
			jobConfigDetails, resp, err := GetJobRunDetails(migrationJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", migrationJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", migrationJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Expected jobRuns not to be empty for config %s", migrationJobConfigIDs[0])
			Expect(jobConfigDetails.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", migrationJobConfigIDs[0])
			Expect(jobConfigDetails.JobType).To(Equal("MIGRATE"), "Expected jobType to be MIGRATE for config %s", migrationJobConfigIDs[0])

			migrationJobRunId := jobConfigDetails.JobRuns[0].JobRunId
			Expect(migrationJobRunId).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
			err = WaitForJobState(migrationJobRunId, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Migration job %s did not complete", migrationJobRunId)
		})

		It("Should run cutover job on the valid volume", func() {
			By("Running cutover job")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", SOURCE_VOLUMES[1])
			destinationPathID1, err := GetExportPathID("destination", DESTINATION_VOLUMES[1], DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{validVolume.ID},
				DestinationPathIDs: []string{destinationPathID1},
			}

			jobConfigIDs, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
			Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
			Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")
			Wait(15)

			By("Getting the job run details")
			jobConfigDetails, resp, err := GetJobRunDetails(jobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", jobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", jobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Expected jobRuns not to be empty for config %s", jobConfigIDs[0])
			Expect(jobConfigDetails.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", jobConfigIDs[0])
			Expect(jobConfigDetails.JobType).To(Equal("CUT_OVER"), "Expected jobType to be CUT_OVER for config %s", jobConfigIDs[0])

			cutoverRunID := jobConfigDetails.JobRuns[0].JobRunId

			waitErr := WaitForJobState(cutoverRunID, BLOCKED_JOBRUN)
			Expect(waitErr).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")

			By("Getting the job run details after reaching BLOCKED state")
			jobRunDetail, resp, err := GetJobRunDetails(jobConfigIDs[0], headers)
			Expect(err).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", jobConfigIDs[0])
			defer resp.Body.Close()

			Expect(len(jobRunDetail.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found for config %s", jobConfigIDs[0])
			Expect(jobRunDetail.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", jobConfigIDs[0])
			Expect(jobRunDetail.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected status BLOCKED for config %s", jobConfigIDs[0])

			By("Approving bulk cutover job")
			approvalResp, approvalErr := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
			Expect(approvalErr).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
			Expect(approvalResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverRunID)
			defer approvalResp.Body.Close()
		})
	})
})
