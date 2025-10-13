package main

import (
	"encoding/base64"
	"fmt"
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

	// Step 1: Generate Support Bundle
	err := GenerateSupportBundle()
	if err != nil {
		LogError(fmt.Errorf("error generating support bundle: %w", err).Error())
		return
	}

	// Wait for bundle to be ready
	Wait(10)

	err = DownloadSupportBundleZip()
	if err != nil {
		LogError(fmt.Errorf("error downloading support bundle: %w", err).Error())
		return
	}

	// Wait for download to complete
	Wait(5)

	zipPath := "ndm_logs.zip"
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
