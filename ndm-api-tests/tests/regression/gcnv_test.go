package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = FDescribe("GCNV Flex Test regression", Ordered, func() {
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
	)

	BeforeAll(func() {
		if PROTOCOL_TYPE == ProtocolSMB {
			Skip("GCNV Flex Test regression is skipped in CI/CD as it is not supported in SMB")
		}
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
		By("Cleanup started")
		err := StopAllWorkersAndWait()
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
			Expect(fileServerDetails.FileServers[0].Protocol).To(Equal(ProtocolNFS), "Expected protocol to be NFS")
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
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s", SOURCE_VOLUMES[1]),
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
			Expect(fileServerDetails.FileServers[0].Volumes[0].VolumePath).To(Equal(SOURCE_VOLUMES[1]), "Expected volume export path to match the uploaded path")
			Expect(fileServerDetails.FileServers[0].Volumes[0].IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(fileServerDetails.FileServers[0].Volumes[0].IsDisabled).To(BeFalse(), "Expected volume to not be disabled")
		})

		It("Should upload a path file with single invalid path to the file server", func() {
			By("Uploading a path file with single invalid path to the file server")
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
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validVolume.IsDisabled).To(BeTrue(), "Expected volume to not be disabled")
		})

		It("Should reupload a path file with a single valid path to the file server", func() {
			By("Reuploading a path file with a single valid path to the file server")
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s", SOURCE_VOLUMES[1]),
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
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
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
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validVolume.IsValid).To(BeTrue(), "Expected volume to be valid")
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
			fileContent := FileContent{
				FileName: "test_multiple_paths_file.csv",
				FileSize: 2048,
				Contents: fmt.Sprintf("path\n%s\n/srv/invalid_share", SOURCE_VOLUMES[1]),
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
			fmt.Println("fileServerDetails.FileServers[0].Volumes:", fileServerDetails.FileServers[0].Volumes, "expected is : ", SOURCE_VOLUMES[1])
			validVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
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
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s", SOURCE_VOLUMES[0]),
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
			validPath1, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
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
			validPath2, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[0])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume path")
			Expect(validPath2.IsValid).To(BeTrue(), "Expected volume to be valid")
			Expect(validPath2.IsDisabled).To(BeFalse(), "Expected volume to not be disabled")
		})

		It("Should reupload a path file with 1 valid path and 1 invalid path", func() {
			By("Uploading a path file with a single valid path and a single invalid path to the file server")
			fileContent := FileContent{
				FileName: "test_single_path_file.csv",
				FileSize: 1024,
				Contents: fmt.Sprintf("path\n%s\n/srv/invalid_share1", SOURCE_VOLUMES[0]),
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
			validPath1, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[0])
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
			By(fmt.Sprintf("Getting volume details for the %s path", SOURCE_VOLUMES[1]))
			validPath2, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
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
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", SOURCE_VOLUMES[1])

			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{invalidVolume.ID},
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

		It("Should create a destination file server with auto upload option", func() {
			By("Creating the destination file server")
			destinationServerParams := CreateServereParams{
				ConfigName:       "destination_auto_upload",
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         "Root",
				Password:         "",
				Protocol:         ProtocolNFS,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			var err error
			var resp *http.Response
			DestinationConfigID, resp, err = CreateFileServer(destinationServerParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(DestinationConfigID).NotTo(BeEmpty(), "DestinationConfigID is empty")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			_, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], DestinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			defer resp.Body.Close()
		})

		It("Should verify the file server creation with auto upload option", func() {
			By("Fetching the latest created file server")
			Expect(DestinationConfigID).NotTo(BeEmpty(), "DestinationConfigID is empty")
			fileServerDetails, err := GetFileServerDetails(DestinationConfigID, headers)

			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			Expect(fileServerDetails.FileServers[0].ExportPathSource).To(Equal(AutoDiscover), "Expected export path source to be AutoDiscover")
			Expect(len(fileServerDetails.FileServers)).To(BeNumerically("==", 1), "Expected exactly one file server to be returned")
			Expect(fileServerDetails.FileServers[0].Protocol).To(Equal(ProtocolNFS), "Expected protocol to be NFS")
			Expect(fileServerDetails.FileServers[0].ProtocolVersion).To(Equal(ProtocolVersion3), "Expected protocol version to be 3")
			Expect(fileServerDetails.FileServers[0].ExportPathSource).To(Equal(AutoDiscover), "Expected export path source to be AutoDiscover")
			Expect(len(fileServerDetails.FileServers[0].Volumes)).To(BeNumerically(">", 0), "Expected volumes to be present in the file server")
			DestinationFileServerId = fileServerDetails.FileServers[0].Id
			Expect(DestinationFileServerId).NotTo(BeEmpty(), "DestinationFileServerId is empty")
		})

		It("Should return an error when trying to run migration job on the invalid enabled volume", func() {
			By("Running migration job on the invalid enabled volume")
			fileServerDetails, err := GetFileServerDetails(SourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get file server details API request")
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, "/srv/invalid_share1")
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '/srv/invalid_share1'")
			destinationPathID1, err := GetExportPathID("destination", DESTINATION_VOLUMES[1], DestinationConfigID, headers)
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
			destinationPathID1, err := GetExportPathID("destination", DESTINATION_VOLUMES[1], DestinationConfigID, headers)
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
			invalidVolume, err := GetVolumeDetailsFromFileServer(fileServerDetails.FileServers[0].Volumes, SOURCE_VOLUMES[1])
			Expect(err).NotTo(HaveOccurred(), "Expected to find volume with path '%s'", SOURCE_VOLUMES[1])
			destinationPathID1, err := GetExportPathID("destination", DESTINATION_VOLUMES[1], DestinationConfigID, headers)
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
