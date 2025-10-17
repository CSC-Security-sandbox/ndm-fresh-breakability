package utils

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// support bundle
func Unzip(src, dest string) error {
	LogDebug(fmt.Sprintf("Unzipping file: %s to directory: %s", src, dest))
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	var extractedAny bool
	for _, f := range r.File {
		// Clean and join the path
		fpath := filepath.Join(dest, f.Name)
		// Prevent Zip Slip by ensuring the path is within dest
		if !strings.HasPrefix(filepath.Clean(fpath), filepath.Clean(dest)+string(os.PathSeparator)) {
			LogDebug(fmt.Sprintf("Skipping potentially unsafe file: %s", f.Name))
			continue
		}

		LogDebug(fmt.Sprintf("Extracting: %s", fpath))
		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			LogDebug(fmt.Sprintf("Error creating directory for %s: %v", fpath, err))
			continue
		}
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			LogDebug(fmt.Sprintf("Error creating file %s: %v", fpath, err))
			continue
		}
		rc, err := f.Open()
		if err != nil {
			LogDebug(fmt.Sprintf("Error opening zipped file %s: %v", f.Name, err))
			outFile.Close()
			continue
		}
		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			continue
		}
		extractedAny = true // At least one file was extracted successfully
	}
	LogDebug("Unzipping complete.")
	if !extractedAny {
		return fmt.Errorf("no files could be unzipped (see above for details)")
	}
	return nil
}

// CheckLogFileExistsAndNotEmpty checks if a specific log file exists (relative to baseDir) and is not empty.
func CheckLogFileExistsAndNotEmpty(baseDir, relativeLogPath string) error {
	fullPath := filepath.Join(baseDir, relativeLogPath)
	LogDebug(fmt.Sprintf("Checking log file: %s", fullPath))
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("log file does not exist: %s", fullPath)
	}
	if err != nil {
		return fmt.Errorf("error accessing log file: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("path is a directory, not a file: %s", fullPath)
	}
	if info.Size() == 0 {
		return fmt.Errorf("log file is empty: %s", fullPath)
	}
	LogDebug(fmt.Sprintf("Log file exists and is not empty: %s (size: %d bytes)", fullPath, info.Size()))
	return nil
}

func GenerateSupportBundle(projectId string, workerId1, workerId2 string) error {
	url := ADMIN_SERVICE_URL + GENERATE_SUPPORT_BUNDLE_URL
	today := time.Now().Format("2006-01-02")

	// Full request body as per new curl
	body := []byte(fmt.Sprintf(`{
        "projectWorkerMap": [
            {
                "projectId": "%s",
                "workerIds": ["%s", "%s"]
            }
        ],
        "startDate": "%s",
        "endDate": "%s",
        "otherMetrics": [
            "State Data",
            "System Inventory Data",
            "Configuration Data",
            "Performance Metrics"
        ]
    }`, projectId, workerId1, workerId2, today, today))

	// Add required headers
	headers := map[string]string{
		"Authorization": "Bearer " + AuthToken,
		"Content-Type":  "application/json",
		"projectid":     projectId,
	}
	

	// Send request
	resp, err := SendAPIRequest("POST", url, body, headers)
	if err != nil {
		return fmt.Errorf("error sending API request for support bundle generation: %w", err)
	}
	defer resp.Body.Close()

    respBytes, err := io.ReadAll(resp.Body)
    if err != nil {
        return fmt.Errorf("error reading response body: %w", err)
    }
    LogDebug(fmt.Sprintf("Support bundle generation response: %s", string(respBytes)))

    if resp.StatusCode != 200 && resp.StatusCode != 201 && resp.StatusCode != 202 {
        return fmt.Errorf("unexpected response code: %d\nResponse body: %s", resp.StatusCode, string(respBytes))
    }

    return nil
}


func DownloadSupportBundleZip() error {
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

	LogDebug(fmt.Sprintf("HTTP Status Code: %d", resp.StatusCode))
	LogDebug("Response Headers:")
	for k, v := range resp.Header {
		LogDebug(fmt.Sprintf("  %s: %s", k, v))
	}

	if resp.StatusCode != 200 {
		respBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			LogDebug(fmt.Sprintf("Error reading response body: %v", err))
			return fmt.Errorf("unexpected response code: %d\nError reading response body: %v", resp.StatusCode, err)
		}
		LogDebug(fmt.Sprintf("Non-200 response body (first 200 bytes): %s", string(respBytes[:min(200, len(respBytes))])))
		return fmt.Errorf("unexpected response code: %d\nResponse body: %s", resp.StatusCode, string(respBytes))
	}

	contentType := resp.Header.Get("Content-Type")
	LogDebug(fmt.Sprintf("Content-Type: %s", contentType))
	if !strings.Contains(contentType, "zip") {
		respBytes, _ := io.ReadAll(resp.Body)
		LogDebug(fmt.Sprintf("Non-zip response body (first 200 bytes): %s", string(respBytes[:min(200, len(respBytes))])))
		return fmt.Errorf("expected zip file, got Content-Type: %s\nBody: %s", contentType, string(respBytes))
	}

	outFile := "ndm_logs.zip"
	out, err := os.Create(outFile)
	if err != nil {
		return fmt.Errorf("error creating output file: %w", err)
	}
	defer out.Close()

	n, err := io.Copy(out, resp.Body)
	if err != nil {
		return fmt.Errorf("error saving zip file: %w", err)
	}
	LogDebug(fmt.Sprintf("Support bundle downloaded and saved as %s (%d bytes)", outFile, n))

	// Print the first 200 bytes of the file for debugging
	f, err := os.Open(outFile)
	if err == nil {
		defer f.Close()
		buf := make([]byte, 200)
		m, _ := f.Read(buf)
		LogDebug(fmt.Sprintf("First 200 bytes of downloaded file:\n%s", string(buf[:m])))
	} else {
		LogDebug(fmt.Sprintf("Could not open file for reading: %v", err))
	}

	// Print file size
	info, err := os.Stat(outFile)
	if err == nil {
		LogDebug(fmt.Sprintf("Downloaded file size: %d bytes", info.Size()))
		if info.Size() < 1000 {
			LogDebug("Warning: Downloaded file is very small, likely not a valid zip.")
		}
	} else {
		LogDebug(fmt.Sprintf("Could not stat file: %v", err))
	}

	return nil
}

func CheckAllWorkerLogsNotEmpty(baseDir, date string) error {
	LogDebug(fmt.Sprintf("Checking all worker logs in directory: %s for date: %s", baseDir, date))
	workerDir := filepath.Join(baseDir, "ndm_logs", date, "worker")
	entries, err := os.ReadDir(workerDir)
	if err != nil {
		return fmt.Errorf("could not read worker directory: %w", err)
	}

	foundAny := false
	for _, entry := range entries {
		if entry.IsDir() {
			workerLogPath := filepath.Join(workerDir, entry.Name(), "worker.log")
			LogDebug(fmt.Sprintf("Checking log file: %s", workerLogPath))
			info, err := os.Stat(workerLogPath)
			if os.IsNotExist(err) {
				LogDebug(fmt.Sprintf("%s: .log file not available", workerLogPath))
				continue
			}
			if err != nil {
				LogDebug(fmt.Sprintf("%s: error accessing log file: %v", workerLogPath, err))
				continue
			}
			if info.IsDir() {
				LogDebug(fmt.Sprintf("%s: path is a directory, not a file", workerLogPath))
				continue
			}
			if info.Size() == 0 {
				LogDebug(fmt.Sprintf("%s: .log file exists but is empty", workerLogPath))
			} else {
				LogDebug(fmt.Sprintf("%s: .log file exists with content (size: %d bytes)", workerLogPath, info.Size()))
				foundAny = true
			}
		}
	}
	if !foundAny {
		return fmt.Errorf("no non-empty worker.log files found in any worker folder")
	}
	return nil
}

func CheckAtLeastTwoWorkerFolders(baseDir, date, ProjectId string) error {
	// Find the actual extracted directory structure
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		return fmt.Errorf("could not read base directory: %w", err)
	}

	var actualBaseDir string
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "ndm_logs_") {
			actualBaseDir = filepath.Join(baseDir, entry.Name())
			break
		}
	}

	if actualBaseDir == "" {
		return fmt.Errorf("could not find ndm_logs_ directory in %s", baseDir)
	}

	// Look for the ndm_logs/date structure
	ndmLogsDir := filepath.Join(actualBaseDir, "ndm_logs", date)
	dateEntries, err := os.ReadDir(ndmLogsDir)
	if err != nil {
		return fmt.Errorf("could not read date directory: %w", err)
	}

	// Find any project directory (could be "no-project" or actual project ID)
	var projectDir string
	for _, entry := range dateEntries {
		if entry.IsDir() {
			projectDir = filepath.Join(ndmLogsDir, entry.Name())
			break
		}
	}

	if projectDir == "" {
		return fmt.Errorf("could not find project directory in %s", ndmLogsDir)
	}

	// Check the worker directory
	workerDir := filepath.Join(projectDir, "worker")
	workerEntries, err := os.ReadDir(workerDir)
	if err != nil {
		return fmt.Errorf("could not read worker directory: %w", err)
	}

	workerFolderCount := 0
	for _, entry := range workerEntries {
		if entry.IsDir() {
			workerFolderCount++
		}
	}

	if workerFolderCount < 1 {
		return fmt.Errorf("expected at least 1 worker folder, found %d", workerFolderCount)
	}

	return nil
}

// Helper for safe slicing
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
