package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("GCNV Flex Test regression", Ordered, func() {
	var (
		ProjectId               string
		workerId1               string
		workerId2               string
		workerIds               []string
		headers                 map[string]string
		attachedWorkersConfig   map[string]SSHConfig
		SourceConfigID          string
		DestinationConfigID     string
		FileServerId            string
		DestinationFileServerId string
		clonedSourceVolumes     []string
		clonedDestVolumes       []string
		sourceVolumeManager     *TestVolumeManager
		destVolumeManager       *TestVolumeManager
	)

	BeforeAll(func() {
		if PROTOCOL_TYPE == ProtocolSMB {
			Skip("GCNV Flex Test regression is skipped in CI/CD as it is not supported in SMB")
		}
		var err error
		var ProjectName string
		numberOfWorker := 2
		ProjectId, ProjectName, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
		_ = ProjectName
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 2), "Expected 2 workers to be attached")
		workerIds = GetWorkerIds()
		workerId1 = workerIds[0]
		workerId2 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)

		// Setup volume cloning for test execution
		clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
		if err != nil {
			Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
		}

		// Guarantee cleanup of cloned volumes even on manual interrupt (Ctrl+C)
		DeferCleanup(func() {
			err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}
		})
	})

	AfterAll(func() {
		if PROTOCOL_TYPE == ProtocolSMB {
			LogDebug("Skipping cleanup as test was skipped for SMB protocol")
			return
		}

		By("Cleanup started")

		// Cleanup ONTAP cloned volumes using volume manager
		err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
		if err != nil {
			LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
		}

		err = StopAllWorkersAndWait()
		Expect(err).NotTo(HaveOccurred(), "Error stopping workers")
		err = CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		LogDebug("Cleanup completed")
	})

	Context("Setup", func() {
		It("Should create a file server with manual upload option", func() {
			By("Creating the file server")
			sourceServerParams := CreateServereParams{
				ConfigName:       "source_manual_upload",
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
				ExportPathSource: PtrExportPathSource(ManualUpload),
			}
			var err error
			var resp *http.Response
			SourceConfigID, resp, err = CreateFileServer(sourceServerParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(SourceConfigID).NotTo(BeEmpty(), "SourceConfigID is empty")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
		})

		It("Should verify the file server creation with manual upload option", func() {
			By("Fetching the latest created file server")
			Expect(SourceConfigID).NotTo(BeEmpty(), "SourceConfigID is empty")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)

			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(fileServerDetails.FileServers[0].ExportPathSource).To(Equal(ManualUpload), "Expected export path source to be ManualUpload")
			Expect(len(fileServerDetails.FileServers)).To(BeNumerically("==", 1), "Expected exactly one file server to be returned")
			Expect(fileServerDetails.FileServers[0].Protocol).To(Equal(PROTOCOL_TYPE), "Expected protocol to match configured protocol type")
			Expect(fileServerDetails.FileServers[0].ProtocolVersion).To(Equal(ProtocolVersion3), "Expected protocol version to be 3")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 0), "Expected no volumes to be present in the file server")
			FileServerId = fileServerDetails.FileServers[0].Id
		})

		It("Should return error while uploading an empty path file to the file server", func() {
			By("Uploading an empty path file to the file server")
			fileContent := FileContent{
				FileName: "test_empty_path_file.csv",
				FileSize: 0,
				Contents: "",
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest), "Expected HTTP 400 BAD REQUEST")
			defer resp.Body.Close()
			Expect(err).NotTo(HaveOccurred(), "Error uploading file with headers only")
			Expect(uploadStats.Message).To(Equal("An unexpected error occurred while uploading the file. The CSV file is either empty or missing a valid header. It should start with \"path\"."))
			Expect(uploadStats.UploadId).To(BeEmpty(), "Expected empty upload ID for empty file")
		})

		It("Should return error while uploading a path file with incorrect headers", func() {
			By("Uploading a file with headers only")
			fileContent := FileContent{
				FileName: "test_headers_only.csv",
				FileSize: 0,
				Contents: "exports",
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest), "Expected HTTP 400 BAD REQUEST")
			Expect(err).NotTo(HaveOccurred(), "Error uploading file with headers only")
			defer resp.Body.Close()
			Expect(uploadStats.Message).To(Equal("An unexpected error occurred while uploading the file. The CSV file is either empty or missing a valid header. It should start with \"path\"."))
			Expect(uploadStats.UploadId).To(BeEmpty(), "Expected empty upload ID for empty file")
		})

		It("Should return error while uploading a file with headers only", func() {
			By("Uploading a file with headers only")
			fileContent := FileContent{
				FileName: "test_headers_only.csv",
				FileSize: 0,
				Contents: "path",
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusBadRequest), "Expected HTTP 400 BAD REQUEST")
			Expect(err).NotTo(HaveOccurred(), "Error uploading file with headers only")
			defer resp.Body.Close()
			Expect(uploadStats.Message).To(Equal("An unexpected error occurred while uploading the file. The CSV file is empty or lacks valid export paths."))
			Expect(uploadStats.UploadId).To(BeEmpty(), "Expected empty upload ID for empty file")
		})

		It("Should upload a path file with a single valid path to the file server", func() {
			By("Uploading a path file with a single valid path to the file server")
			// Format cloned volume name as NFS export path (add leading /)
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s", sourcePath1),
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error uploading path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 1), "Expected new path to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 0), "Expected no already existing paths")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 0), "Expected no paths to be no longer available")
			Wait(10)

			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(60)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 1), "Expected one volumes to be present in the file server")
		    sourcePath1 = fmt.Sprintf("/%s", clonedSourceVolumes[1])
			Expect(fileServerDetails.FileServers[0].Volumes[0].VolumePath).To(Equal(sourcePath1), "Expected volume export path to match the uploaded path")
			Expect(fileServerDetails.FileServers[0].Volumes[0].IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(fileServerDetails.FileServers[0].Volumes[0].IsDisabled).To(BeFalse(), "Expected volume to not be disabled")
		})

		It("Should upload a path file with single invalid path to the file server", func() {
			By("Uploading a path file with single invalid path to the file server")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			fileContent := FileContent{
				FileName: "test_single_invalid_path_file.csv",
				FileSize: 1024,
				Contents: "path\n/srv/invalid_share",
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error uploading path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 1), "Expected one new paths to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 0), "Expected no already existing paths")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 1), "Expected one path to be no longer available")
			Wait(10)
			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(20)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 2), "Expected two volumes to be present in the file server")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")

			// GetVolumeDetailsFromFileServer for the valid path
			By("Getting volume details for the valid path")
			sourcePath1 = fmt.Sprintf("/%s", clonedSourceVolumes[1])
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validVolume.IsDisabled).To(BeTrue(), "Expected volume to not be disabled")
		})

		It("Should reupload a path file with a single valid path to the file server", func() {
			By("Reuploading a path file with a single valid path to the file server")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s", sourcePath1),
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error reuploading path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 0), "Expected no new paths to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 1), "Expected one already existing path")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 1), "Expected one paths to be no longer available")
			Wait(10)

			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(20)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 2), "Expected two volumes to be present in the file server")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the valid path")
			sourcePath1 = fmt.Sprintf("/%s", clonedSourceVolumes[1])
		validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validVolume.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeTrue(), "Expected volume to be disabled")
		})

		It("Should reupload a path file with single invalid path to the file server", func() {
			By("Reuploading a path file with single invalid path to the file server")
			fileContent := FileContent{
				FileName: "test_single_invalid_path_file.csv",
				FileSize: 1024,
				Contents: "path\n/srv/invalid_share",
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error reuploading path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 0), "Expected no new paths to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 1), "Expected one already existing paths")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 1), "Expected one path to be no longer available")
			Wait(10)

			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(20)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 2), "Expected two volumes to be present in the file server")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the valid path")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(validVolume.IsDisabled).To(BeTrue(), "Expected volume to not be disabled")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeFalse(), "Expected volume to be disabled")
		})

		It("Should reupload a path file with multiple paths to the file server", func() {
			By("Reuploading a path file with multiple paths to the file server")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			fileContent := FileContent{
				FileName: "test_multiple_paths_file.csv",
				FileSize: 2048,
				Contents: fmt.Sprintf("path\n%s\n/srv/invalid_share", sourcePath1),
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error reuploading path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 0), "Expected no new paths to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 2), "Expected two already existing paths")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 0), "Expected no paths to be no longer available")
			Wait(10)

			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(20)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 2), "Expected two volumes to be present in the file server")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the valid path")
			sourcePath1 = fmt.Sprintf("/%s", clonedSourceVolumes[1])
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validVolume.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeFalse(), "Expected volume to be disabled")
		})

		It("Should reupload a path file with 1 new valid path", func() {
			By("Uploading a path file with a single valid path to the file server")
			sourcePath0 := fmt.Sprintf("/%s", clonedSourceVolumes[0])
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s", sourcePath0),
			}
			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error uploading path file")
			defer resp.Body.Close()

			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 1), "Expected new path to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 0), "Expected no already existing paths")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 2), "Expected two paths to be no longer available")
			Wait(10)

			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(30)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 3), "Expected three volumes to be present in the file server")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the valid path")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			validPath1, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validPath1.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validPath1.IsDisabled).To(BeTrue(), "Expected volume to not be disabled")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeTrue(), "Expected volume to be disabled")

			// GetVolumeDetailsFromFileServer for gcnv_share
			By("Getting volume details for the gcnv_share path")
	sourcePath0 = fmt.Sprintf("/%s", clonedSourceVolumes[0])
			validPath2, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath0)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validPath2.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validPath2.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")
		})

		It("Should reupload a path file with 1 valid path and 1 invalid path", func() {
			By("Uploading a path file with a single valid path and a single invalid path to the file server")
			sourcePath0 := fmt.Sprintf("/%s", clonedSourceVolumes[0])
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s\n/srv/invalid_share1", sourcePath0),
			}

			resp, uploadStats, err := UploadPathFile(FileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error uploading path file")
			defer resp.Body.Close()

			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 1), "Expected new path to be uploaded")
			Expect(uploadStats.AlreadyExitingPaths).To(BeNumerically("==", 1), "Expected one already existing path")
			Expect(uploadStats.NoLongerAvailablePaths).To(BeNumerically("==", 2), "Expected two paths to be no longer available")
			Wait(10)

			// Confirm the upload and wait for 30 seconds
			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(30)

			// Confirm volume creation
			By("Confirming the volume creation")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 4), "Expected four volumes to be present in the file server")

			// GetVolumeDetailsFromFileServer for the valid path
			By("Getting volume details for the valid path")
		sourcePath0 = fmt.Sprintf("/%s", clonedSourceVolumes[0])
			validPath1, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath0)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validPath1.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validPath1.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share1")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share1'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeFalse(), "Expected volume to be disabled")

			// GetVolumeDetailsFromFileServer for NFS_SOURCE_VOLUME_1
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			By(fmt.Sprintf("Getting volume details for the %s path", sourcePath1))
			validPath2, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validPath2.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validPath2.IsDisabled).To(BeTrue(), "Expected volume to be disabled")

			// GetVolumeDetailsFromFileServer for the invalid path
			By("Getting volume details for the invalid path")
			invalidVolume, err = GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			Expect(invalidVolume.IsValid).To(BeFalse(), "Expected volume to be invalid")
			Expect(invalidVolume.IsDisabled).To(BeTrue(), "Expected volume to be disabled")
		})

		It("Should return an error when trying to run discovery job on the invalid enabled volume", func() {
			By("Running discovery job on the valid disabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")

			jobParams := DiscoveryJobParams{
		SourcePathIDs:            []string{invalidVolume.ID},
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
			sourceJobConfigIDs, resp, err := CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			Wait(15)

			By("Getting the job run details")
			jobRunDetails, resp, err := GetJobRunDetails(sourceJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", sourceJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", sourceJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobRunDetails.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", sourceJobConfigIDs[0])
			Expect(jobRunDetails.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", sourceJobConfigIDs[0])
			Expect(jobRunDetails.JobType).To(Equal("DISCOVER"), "Expected jobType to be DISCOVER for config %s", sourceJobConfigIDs[0])
		})

		It("Should return an error when trying to run discovery job on the invalid disabled volume", func() {
			By("Running discovery job on the invalid enabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share1")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share1'")

			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{invalidVolume.ID},
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
			sourceJobConfigIDs, resp, err := CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()
			Wait(15)

			By("Getting the job run details")
			jobRunDetails, resp, err := GetJobRunDetails(sourceJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", sourceJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", sourceJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobRunDetails.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", sourceJobConfigIDs[0])
			Expect(jobRunDetails.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", sourceJobConfigIDs[0])
			
			Expect(jobRunDetails.JobType).To(Equal("DISCOVER"), "Expected jobType to be DISCOVER for config %s", sourceJobConfigIDs[0])
		})

		It("Should return an error when trying to run discovery job on the valid disabled volume", func() {
			By("Running discovery job on the invalid enabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", sourcePath1)

			jobParams := DiscoveryJobParams{
			SourcePathIDs:            []string{validVolume.ID},
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
			sourceJobConfigIDs, resp, err := CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()
			Wait(15)

			By("Getting the job run details")
			jobRunDetails, resp, err := GetJobRunDetails(sourceJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", sourceJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", sourceJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobRunDetails.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", sourceJobConfigIDs[0])
			Expect(jobRunDetails.Status).To(Equal("ACTIVE"), "Expected status to be ACTIVE for config %s", sourceJobConfigIDs[0])
			Expect(jobRunDetails.JobType).To(Equal("DISCOVER"), "Expected jobType to be DISCOVER for config %s", sourceJobConfigIDs[0])
		})

		It("Should create a destination file server", func() {
			By("Creating the destination file server")
			destinationServerParams := CreateServereParams{
				ConfigName:      "destination_file_server",
				ConfigType:      ConfigTypeFile,
				ProjectID:       ProjectId,
				ServerType:      ServerTypeOtherNAS,
				UserName:        PROTOCOL_USERNAME,
				Password:        PROTOCOL_PASSWORD,
				Protocol:        PROTOCOL_TYPE,
				ProtocolVersion: ProtocolVersion3,
				Host:            DESTINATION_HOST_IPs[0],
				Workers:         []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			if VOLUME_CLONE_PROVIDER == VolumeCloneProviderGCNV {
				destinationServerParams.ExportPathSource = PtrExportPathSource(ManualUpload)
			}
			var err error
			var resp *http.Response
			DestinationConfigID, resp, err = CreateFileServer(destinationServerParams, headers)
			defer resp.Body.Close()
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(DestinationConfigID).NotTo(BeEmpty(), "DestinationConfigID is empty")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		})

		It("Should verify the destination file server creation", func() {
			By("Fetching the latest created file server")
			if VOLUME_CLONE_PROVIDER != VolumeCloneProviderGCNV {
				Wait(40)
			}
			Expect(DestinationConfigID).NotTo(BeEmpty(), "DestinationConfigID is empty")
			fileServerDetails, err := GetFileServerDetails(DestinationConfigID, headers)

			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers)).To(BeNumerically("==", 1), "Expected exactly one file server to be returned")
			Expect(fileServerDetails.FileServers[0].Protocol).To(Equal(PROTOCOL_TYPE), "Expected protocol to match configured protocol type")
			Expect(fileServerDetails.FileServers[0].ProtocolVersion).To(Equal(ProtocolVersion3), "Expected protocol version to be 3")
			if VOLUME_CLONE_PROVIDER == VolumeCloneProviderGCNV {
				Expect(fileServerDetails.FileServers[0].ExportPathSource).To(Equal(ManualUpload), "Expected export path source to be ManualUpload")
				Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 0), "Expected no volumes to be present in the file server")
			} else {
				Expect(fileServerDetails.FileServers[0].ExportPathSource).To(Equal(AutoDiscover), "Expected export path source to be AutoDiscover")
				Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically(">", 0), "Expected volumes to be present in the file server")
			}
			DestinationFileServerId = fileServerDetails.FileServers[0].Id
			Expect(DestinationFileServerId).NotTo(BeEmpty(), "DestinationFileServerId is empty")
		})

		It("Should upload destination path file to the destination file server", func() {
			if VOLUME_CLONE_PROVIDER != VolumeCloneProviderGCNV {
				Skip("Destination path file upload is only needed for GCNV clone provider")
			}
			By("Uploading destination volume paths to the destination file server")
			destPath0 := fmt.Sprintf("/%s", clonedDestVolumes[0])
			destPath1 := fmt.Sprintf("/%s", clonedDestVolumes[1])
			fileContent := FileContent{
				FileName: "dest_paths.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s\n%s", destPath0, destPath1),
			}
			resp, uploadStats, err := UploadPathFile(DestinationFileServerId, fileContent, headers)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(err).NotTo(HaveOccurred(), "Error uploading destination path file")
			defer resp.Body.Close()
			Expect(uploadStats.UploadId).NotTo(BeEmpty(), "Expected non-empty upload ID")
			Expect(uploadStats.NewPaths).To(BeNumerically("==", 2), "Expected two new paths to be uploaded")
			Wait(10)

			confirmResp, confirmStats, err := ConfirmPathFileUpload(uploadStats.UploadId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error confirming destination path file upload")
			Expect(confirmResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(confirmStats.WorkflowId).NotTo(BeEmpty(), "Expected non-empty workflow ID")
			Wait(60)

			By("Confirming destination volumes were created")
			fileServerDetails, err := GetFileServerDetails(DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically("==", 2), "Expected two volumes to be present in the destination file server")
		})

		It("Should return an error when trying to run migration job on the invalid enabled volume", func() {
			By("Running migration job on the invalid enabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share1")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share1'")
			destPath := fmt.Sprintf("/%s", clonedDestVolumes[1])
			destinationPathID1, err := GetExportPathID("destination", destPath, DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{invalidVolume.ID},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "15-M",
				},
			}
			migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()
			Wait(15)

			By("Getting the job run details")
			jobRunDetails, resp, err := GetJobRunDetails(migrationJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", migrationJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", migrationJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobRunDetails.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", migrationJobConfigIDs[0])
			Expect(jobRunDetails.JobType).To(Equal("MIGRATE"), "Expected jobType to be MIGRATE for config %s", migrationJobConfigIDs[0])
		})

		It("Should return an error when trying to run migration job on the invalid disabled volume", func() {
			By("Running migration job on the invalid disabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share'")
			destPath := fmt.Sprintf("/%s", clonedDestVolumes[1])
			destinationPathID1, err := GetExportPathID("destination", destPath, DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{invalidVolume.ID},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "15-M",
				},
			}
			migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()
			Wait(15)

			By("Getting the job run details")
			jobRunDetails, resp, err := GetJobRunDetails(migrationJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", migrationJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", migrationJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobRunDetails.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", migrationJobConfigIDs[0])
			Expect(jobRunDetails.JobType).To(Equal("MIGRATE"), "Expected jobType to be MIGRATE for config %s", migrationJobConfigIDs[0])
		})

		It("Should return an error when trying to run migration job on the valid disabled volume", func() {
			By("Running migration job on the valid disabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			sourcePath1 := fmt.Sprintf("/%s", clonedSourceVolumes[1])
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, sourcePath1)
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", sourcePath1)
			destPath := fmt.Sprintf("/%s", clonedDestVolumes[1])
			destinationPathID1, err := GetExportPathID("destination", destPath, DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{invalidVolume.ID},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "15-M",
				},
			}
			migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()
			Wait(15)

			By("Getting the job run details")
			jobRunDetails, resp, err := GetJobRunDetails(migrationJobConfigIDs[0], headers, false)
			Expect(err).NotTo(HaveOccurred(), "Error getting job run ID for config %s", migrationJobConfigIDs[0])
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", migrationJobConfigIDs[0])
			defer resp.Body.Close()
			Expect(jobRunDetails.JobRuns).To(BeEmpty(), "Expected jobRuns to be empty for config %s", migrationJobConfigIDs[0])
			Expect(jobRunDetails.JobType).To(Equal("MIGRATE"), "Expected jobType to be MIGRATE for config %s", migrationJobConfigIDs[0])
		})
	})
})