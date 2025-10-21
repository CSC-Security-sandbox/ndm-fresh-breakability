package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	. "ndm-api-tests/utils"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	BUILD_VERSION = os.Getenv("BUILD_VERSION")
	REF_TYPE = os.Getenv("REF_TYPE")
	NDM_NEXUS_USERNAME = os.Getenv("NDM_NEXUS_USERNAME")
	NDM_NEXUS_PASSWORD = os.Getenv("NDM_NEXUS_PASSWORD")

	if BUILD_VERSION == "" || REF_TYPE == "" || NDM_NEXUS_USERNAME == "" || NDM_NEXUS_PASSWORD == "" {
		LogError("One or more required environment variables are not set: BUILD_VERSION, REF_TYPE, NDM_NEXUS_USERNAME, NDM_NEXUS_PASSWORD")
		return
	}

	// Initialize the setup without worker attach setup
	InitTestEnv()

	// Step 1: Fetch project IDs
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	projectIds, err := getProjectIds(headers)
	if err != nil {
		LogError(fmt.Sprintf("Error fetching project IDs: %v", err))
		return
	}
	if len(projectIds) == 0 {
		LogError("No projects found")
		return
	}
	LogDebug(fmt.Sprintf("Found %d projects", len(projectIds)))

	// Step 2: Build map of projectID -> workerIDs
	projectWorkerMap := make(map[string][]string)
	for _, projectId := range projectIds {
		workerIds, err := getWorkerIdsByProject(headers, projectId)
		if err != nil {
			LogError(fmt.Sprintf("Error fetching workers for project %s: %v", projectId, err))
			continue
		}
		if len(workerIds) > 0 {
			projectWorkerMap[projectId] = workerIds
			LogDebug(fmt.Sprintf("Project %s has %d workers", projectId, len(workerIds)))
		} else {
			LogDebug(fmt.Sprintf("Skipping project %s - no workers found", projectId))
		}
	}

	if len(projectWorkerMap) == 0 {
		LogError("No projects found with workers")
		return
	}

	// Step 3: Generate Support Bundle for each project
	var downloadedZips []string
	projectIndex := 0

	for projectId, workerIds := range projectWorkerMap {
		projectIndex++
		workerId1 := ""
		workerId2 := ""

		if len(workerIds) >= 1 {
			workerId1 = workerIds[0]
		}
		if len(workerIds) >= 2 {
			workerId2 = workerIds[1]
		}

		LogDebug(fmt.Sprintf("Generating support bundle for project %d/%d: %s with workers: %s, %s",
			projectIndex, len(projectWorkerMap), projectId, workerId1, workerId2))

		err = GenerateSupportBundle(projectId, workerId1, workerId2)
		if err != nil {
			LogError(fmt.Sprintf("Error generating support bundle for project %s: %v", projectId, err))
			continue
		}
		LogDebug(fmt.Sprintf("Successfully generated support bundle for project %s", projectId))

		// Wait for bundle to be ready
		LogDebug(fmt.Sprintf("Waiting for support bundle to be ready for project %s", projectId))
		Wait(10)

		// Download the support bundle for this project
		zipPath := fmt.Sprintf("ndm_logs_project_%d.zip", projectIndex)
		err = DownloadSupportBundleZipWithPath(zipPath)
		if err != nil {
			LogError(fmt.Sprintf("Error downloading support bundle for project %s: %v", projectId, err))
			continue
		}
		LogDebug(fmt.Sprintf("Successfully downloaded support bundle for project %s to %s", projectId, zipPath))
		downloadedZips = append(downloadedZips, zipPath)

		// Small wait between projects
		Wait(2)
	}

	if len(downloadedZips) == 0 {
		LogError("No support bundles were successfully downloaded")
		return
	}

	// Step 4: Combine all downloaded zips into one
	LogDebug(fmt.Sprintf("Combining %d support bundles into one zip file", len(downloadedZips)))
	combinedZipPath := "ndm_logs_combined.zip"
	err = CombineZipFiles(downloadedZips, combinedZipPath)
	if err != nil {
		LogError(fmt.Sprintf("Error combining zip files: %v", err))
		return
	}
	LogDebug(fmt.Sprintf("Successfully combined all support bundles into %s", combinedZipPath))

	// Clean up individual zip files
	for _, zipPath := range downloadedZips {
		os.Remove(zipPath)
	}

	zipPath := combinedZipPath
	// Step 2: Upload Support Bundle
	if strings.Contains(BUILD_VERSION, "nightly") || REF_TYPE == "releases" {
		buildType := ""
		if strings.Contains(BUILD_VERSION, "nightly") {
			buildType = "builds/nightly"
		} else if REF_TYPE == "releases" {
			buildType = "releases"
		}
		err = UploadSupportBundleToArtifactory(buildType, BUILD_VERSION, zipPath)
		if err != nil {
			LogDebug(fmt.Sprintf("Support bundle upload failed: %v", err))
		} else {
			LogDebug("Support bundle uploaded successfully to Artifactory")
		}
	}
}

func UploadSupportBundleToArtifactory(buildType, buildVersion, zipFilePath string) error {
	// Check if the downloaded zip file exists
	if _, err := os.Stat(zipFilePath); os.IsNotExist(err) {
		return fmt.Errorf("zip file does not exist: %s. Please run DownloadSupportBundleZip() first", zipFilePath)
	}

	// Get file info for Content-Length header
	fileInfo, err := os.Stat(zipFilePath)
	if err != nil {
		return fmt.Errorf("error getting file info: %w", err)
	}

	LogDebug(fmt.Sprintf("File size: %d bytes", fileInfo.Size()))

	// Open the zip file for streaming upload
	file, err := os.Open(zipFilePath)
	if err != nil {
		return fmt.Errorf("error opening zip file: %w", err)
	}
	defer file.Close()

	artifactoryPath := fmt.Sprintf("%s/%s/support-bundles", buildType, buildVersion)

	// Generate timestamped filename
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("ndm_logs_%s.zip", timestamp)

	uploadURL := fmt.Sprintf("%s/cicd/ndm/%s/%s",
		ARTIFACTORY_URL, artifactoryPath, filename)

	LogDebug(fmt.Sprintf("Starting upload of %s to Artifactory: %s", zipFilePath, uploadURL))

	// Reset file position for each upload
	file.Seek(0, 0)
	// Create HTTP request with file as body (streaming upload)
	req, err := http.NewRequest("PUT", uploadURL, file)
	if err != nil {
		return fmt.Errorf("error creating HTTP request: %w", err)
	}

	// Set headers Content-Type and Basic Auth
	req.Header.Set("Content-Type", "application/zip")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))
	auth := base64.StdEncoding.EncodeToString([]byte(NDM_NEXUS_USERNAME + ":" + NDM_NEXUS_PASSWORD))
	req.Header.Set("Authorization", "Basic "+auth)

	// Send the request with silent/show-error/fail flags behavior
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error sending upload request to Artifactory (%s): %w", uploadURL, err)
	}
	defer resp.Body.Close()

	// Check if upload was successful
	if resp.StatusCode != 201 && resp.StatusCode != 200 {
		return fmt.Errorf("artifactory upload failed to %s with status %d", uploadURL, resp.StatusCode)
	}

	LogDebug(fmt.Sprintf("Successfully uploaded %s (%d bytes) to: %s", zipFilePath, fileInfo.Size(), uploadURL))

	LogDebug("Support bundle upload completed successfully to all repository paths")
	return nil
}

func getProjectIds(headers map[string]string) ([]string, error) {
	getProjectListURL := fmt.Sprintf("%s/api/v1/projects?limit=1000", ADMIN_SERVICE_URL)
	resp, err := SendAPIRequest("GET", getProjectListURL, nil, headers)
	if err != nil {
		return nil, fmt.Errorf("error sending get project list API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code %d when fetching projects", resp.StatusCode)
	}

	var projectResponse struct {
		Data struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		} `json:"data"`
	}

	err = json.NewDecoder(resp.Body).Decode(&projectResponse)
	if err != nil {
		return nil, fmt.Errorf("error decoding project list response: %w", err)
	}

	projectIds := make([]string, 0, len(projectResponse.Data.Items))
	for _, project := range projectResponse.Data.Items {
		projectIds = append(projectIds, project.ID)
	}

	return projectIds, nil
}

func getWorkerIdsByProject(headers map[string]string, projectId string) ([]string, error) {
	getWorkersURL := fmt.Sprintf("%s/api/v1/workers?projectId=%s&limit=1000", ADMIN_SERVICE_URL, projectId)
	resp, err := SendAPIRequest("GET", getWorkersURL, nil, headers)
	if err != nil {
		return nil, fmt.Errorf("error sending get workers API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code %d when fetching workers for project %s", resp.StatusCode, projectId)
	}

	var workerResponse struct {
		Data struct {
			Items []struct {
				WorkerID string `json:"workerId"`
			} `json:"items"`
		} `json:"data"`
	}

	err = json.NewDecoder(resp.Body).Decode(&workerResponse)
	if err != nil {
		return nil, fmt.Errorf("error decoding workers list response: %w", err)
	}

	workerIds := make([]string, 0, len(workerResponse.Data.Items))
	for _, worker := range workerResponse.Data.Items {
		workerIds = append(workerIds, worker.WorkerID)
	}

	return workerIds, nil
}

func DownloadSupportBundleZipWithPath(outputPath string) error {
	canDownloadURL := ADMIN_SERVICE_URL + IS_SUPPORT_BUNDLE_READY_URL
	downloadURL := ADMIN_SERVICE_URL + DOWNLOAD_SUPPORT_BUNDLE_URL

	headers := GetHeaders(AuthToken, ContentTypeJSON)

	// Poll until isBundleReady is true
	maxAttempts := MaxPollRetries
	pollInterval := 5 * time.Second
	var lastResp CanDownloadResp

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		LogDebug(fmt.Sprintf("Polling for bundle readiness (attempt %d/%d)...", attempt, maxAttempts))
		resp, err := SendAPIRequest("GET", canDownloadURL, nil, headers)
		if err != nil {
			return fmt.Errorf("error sending can-download API request: %w", err)
		}
		respBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		LogDebug(fmt.Sprintf("can-download API response: %s", string(respBytes)))
		err = json.Unmarshal(respBytes, &lastResp)
		if err != nil {
			return fmt.Errorf("failed to parse can-download response: %w", err)
		}

		if lastResp.Data.Items.IsBundleReady {
			LogDebug("Support bundle is ready for download.")
			break
		}
		if attempt == maxAttempts {
			return fmt.Errorf("support bundle not ready after %d attempts", maxAttempts)
		}
		time.Sleep(pollInterval)
	}

	// Download the zip
	LogDebug(fmt.Sprintf("Sending GET request to: %s", downloadURL))
	resp, err := SendAPIRequest("GET", downloadURL, nil, headers)
	if err != nil {
		return fmt.Errorf("error sending API request for bundle download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("unexpected response code: %d\nError reading response body: %v", resp.StatusCode, err)
		}
		return fmt.Errorf("unexpected response code: %d\nResponse body: %s", resp.StatusCode, string(respBytes))
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("error creating output file: %w", err)
	}
	defer out.Close()

	n, err := io.Copy(out, resp.Body)
	if err != nil {
		return fmt.Errorf("error saving zip file: %w", err)
	}
	LogDebug(fmt.Sprintf("Support bundle downloaded and saved as %s (%d bytes)", outputPath, n))

	return nil
}

func CombineZipFiles(zipPaths []string, outputPath string) error {
	// Create output zip file
	outFile, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("error creating combined zip file: %w", err)
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	defer zipWriter.Close()

	// Process each input zip file
	for i, zipPath := range zipPaths {
		LogDebug(fmt.Sprintf("Adding %s to combined zip (%d/%d)", zipPath, i+1, len(zipPaths)))

		// Open the zip file
		zipReader, err := zip.OpenReader(zipPath)
		if err != nil {
			LogError(fmt.Sprintf("Error opening zip file %s: %v", zipPath, err))
			continue
		}

		// Copy all files from this zip to the combined zip
		for _, file := range zipReader.File {
			// Skip directories
			if file.FileInfo().IsDir() {
				LogDebug(fmt.Sprintf("Skipping directory: %s", file.Name))
				continue
			}

			// Create a unique path by prefixing with project number
			newPath := fmt.Sprintf("project_%d/%s", i+1, file.Name)

			LogDebug(fmt.Sprintf("Adding file: %s", newPath))

			// Create the file in the combined zip preserving the original compression method
			header := file.FileHeader
			header.Name = newPath

			writer, err := zipWriter.CreateHeader(&header)
			if err != nil {
				LogError(fmt.Sprintf("Error creating file in combined zip: %v", err))
				continue
			}

			// Open the file from the source zip with OpenRaw to bypass checksum verification
			rawReader, err := file.OpenRaw()
			if err != nil {
				// If OpenRaw fails, try normal Open
				normalReader, err := file.Open()
				if err != nil {
					LogError(fmt.Sprintf("Error opening file from source zip: %v", err))
					continue
				}
				// Copy using normal reader
				_, err = io.Copy(writer, normalReader)
				normalReader.Close()
				if err != nil {
					LogError(fmt.Sprintf("Error copying file content: %v", err))
					continue
				}
			} else {
				// Copy using raw reader (bypasses checksum)
				_, err = io.Copy(writer, rawReader)
				if closer, ok := rawReader.(io.Closer); ok {
					closer.Close()
				}
				if err != nil {
					LogError(fmt.Sprintf("Error copying file content: %v", err))
					continue
				}
			}
		}

		zipReader.Close()
	}

	LogDebug(fmt.Sprintf("Successfully combined %d zip files into %s", len(zipPaths), outputPath))
	return nil
}
