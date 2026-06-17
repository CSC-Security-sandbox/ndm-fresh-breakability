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

func resolveSupportBundleRoot(baseDir string) (string, error) {
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		return "", fmt.Errorf("could not read base directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "ndm_logs_") {
			return filepath.Join(baseDir, entry.Name()), nil
		}
	}

	// Some bundles extract ndm_logs/ directly without the ndm_logs_<userId> wrapper.
	if info, err := os.Stat(filepath.Join(baseDir, "ndm_logs")); err == nil && info.IsDir() {
		return baseDir, nil
	}
	return "", fmt.Errorf("could not find ndm_logs_<userId> directory in %s", baseDir)
}

func resolveSupportBundleProjectDir(baseDir, date, projectID string) (string, error) {
	bundleRoot, err := resolveSupportBundleRoot(baseDir)
	if err != nil {
		return "", err
	}

	projectDir := filepath.Join(bundleRoot, "ndm_logs", date, projectID)
	info, err := os.Stat(projectDir)
	if err != nil {
		return "", fmt.Errorf("project directory not found for %s: %w", projectDir, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project path is not a directory: %s", projectDir)
	}
	return projectDir, nil
}

const minSupportBundleZipBytes = 1024

// ValidateSupportBundleZipFile checks the downloaded bundle is a non-trivial valid zip archive.
func ValidateSupportBundleZipFile(zipPath string) error {
	info, err := os.Stat(zipPath)
	if err != nil {
		return fmt.Errorf("could not stat zip file: %w", err)
	}
	if info.Size() < minSupportBundleZipBytes {
		return fmt.Errorf("support bundle zip too small (%d bytes)", info.Size())
	}

	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("invalid zip file: %w", err)
	}
	defer reader.Close()
	if len(reader.File) == 0 {
		return fmt.Errorf("zip file contains no entries")
	}
	return nil
}

// ValidateSupportBundleProjectLayout verifies the expected ndm_logs/{date}/{projectId} tree exists.
func ValidateSupportBundleProjectLayout(baseDir, date, projectID string) error {
	projectDir, err := resolveSupportBundleProjectDir(baseDir, date, projectID)
	if err != nil {
		return err
	}

	requiredSubdirs := []string{"control-plane", "worker"}
	var missing []string
	for _, subdir := range requiredSubdirs {
		path := filepath.Join(projectDir, subdir)
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			missing = append(missing, subdir)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing project subdirectories under %s: %s", projectDir, strings.Join(missing, ", "))
	}
	return nil
}

// ValidateControlPlaneServiceLogs verifies required control-plane logs exist and are non-empty.
func ValidateControlPlaneServiceLogs(baseDir, date, projectID string, logFiles []string) error {
	projectDir, err := resolveSupportBundleProjectDir(baseDir, date, projectID)
	if err != nil {
		return err
	}

	var missing []string
	for _, logFile := range logFiles {
		logPath := filepath.Join(projectDir, "control-plane", logFile)
		info, err := os.Stat(logPath)
		if err != nil || info.IsDir() || info.Size() == 0 {
			if err != nil {
				missing = append(missing, fmt.Sprintf("%s (%v)", logFile, err))
			} else {
				missing = append(missing, logFile)
			}
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing or empty control-plane logs: %s", strings.Join(missing, "; "))
	}
	return nil
}

// ValidateWorkerServiceLogs verifies each worker folder exists and contains at least one non-empty log file.
func ValidateWorkerServiceLogs(baseDir, date, projectID string, workerIDs []string) error {
	projectDir, err := resolveSupportBundleProjectDir(baseDir, date, projectID)
	if err != nil {
		return err
	}

	workerDir := filepath.Join(projectDir, "worker")
	workerEntries, err := os.ReadDir(workerDir)
	if err != nil {
		return fmt.Errorf("could not read worker directory %s: %w", workerDir, err)
	}

	workerFolders := map[string]bool{}
	for _, entry := range workerEntries {
		if entry.IsDir() {
			workerFolders[entry.Name()] = true
		}
	}

	var issues []string
	for _, workerID := range workerIDs {
		if !workerFolders[workerID] {
			issues = append(issues, fmt.Sprintf("worker folder missing for %s", workerID))
			continue
		}
		if err := workerFolderHasNonEmptyLog(filepath.Join(workerDir, workerID)); err != nil {
			issues = append(issues, fmt.Sprintf("worker %s: %v", workerID, err))
		}
	}
	if len(issues) > 0 {
		return fmt.Errorf("worker log validation failed: %s", strings.Join(issues, "; "))
	}
	return nil
}

func workerFolderHasNonEmptyLog(workerFolder string) error {
	var found bool
	err := filepath.WalkDir(workerFolder, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Size() > 0 {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("no non-empty log files under %s", workerFolder)
	}
	return nil
}

type supportBundleMetricsFolderSpec struct {
	label        string
	nameVariants []string
	filePatterns []string // empty = any non-empty .csv
	minFiles     int
	required     bool
}

// ValidateSupportBundleMetricsData verifies CSV exports requested via otherMetrics are present.
func ValidateSupportBundleMetricsData(baseDir string) error {
	bundleRoot, err := resolveSupportBundleRoot(baseDir)
	if err != nil {
		return err
	}

	specs := []supportBundleMetricsFolderSpec{
		{
			label:        "Configuration Data",
			nameVariants: []string{"configuration data", "Configuration Data"},
			filePatterns: []string{"job_config_details_", "worker_env_logs_"},
			minFiles:     1,
			required:     true,
		},
		{
			label:        "State Data",
			nameVariants: []string{"State Data"},
			filePatterns: []string{"service_pods_", "metrics_data_", "build_details_"},
			minFiles:     1,
			required:     false,
		},
		{
			label:        "System Inventory Data",
			nameVariants: []string{"System Inventory", "System Inventory Data"},
			filePatterns: []string{"system-inventory-"},
			minFiles:     1,
			required:     false,
		},
		{
			label:        "Performance Metrics",
			nameVariants: []string{"Performance Metrics"},
			filePatterns: []string{".csv"},
			minFiles:     1,
			required:     false,
		},
	}

	var requiredIssues []string
	var optionalMissing []string
	optionalPresent := 0
	for _, spec := range specs {
		err := validateMetricsFolder(bundleRoot, spec)
		if err == nil {
			if !spec.required {
				optionalPresent++
			}
			continue
		}
		if spec.required {
			requiredIssues = append(requiredIssues, fmt.Sprintf("%s: %v", spec.label, err))
		} else {
			optionalMissing = append(optionalMissing, spec.label)
		}
	}
	if len(requiredIssues) > 0 {
		return fmt.Errorf("metrics validation failed: %s", strings.Join(requiredIssues, "; "))
	}
	// Prometheus-backed exports may be partial depending on scrape coverage; require at least 2 of 3.
	if optionalPresent < 2 {
		return fmt.Errorf(
			"expected at least 2 prometheus-backed metrics folders with csv data, found %d (missing: %s)",
			optionalPresent, strings.Join(optionalMissing, ", "),
		)
	}
	return nil
}

func validateMetricsFolder(bundleRoot string, spec supportBundleMetricsFolderSpec) error {
	folderPath, err := findSupportBundleMetricsFolder(bundleRoot, spec.nameVariants)
	if err != nil {
		return err
	}

	matched, err := countMatchingCSVFiles(folderPath, spec.filePatterns)
	if err != nil {
		return err
	}
	if matched < spec.minFiles {
		return fmt.Errorf(
			"expected at least %d matching csv file(s) in %s, found %d",
			spec.minFiles, folderPath, matched,
		)
	}
	return nil
}

func findSupportBundleMetricsFolder(bundleRoot string, nameVariants []string) (string, error) {
	entries, err := os.ReadDir(bundleRoot)
	if err != nil {
		return "", fmt.Errorf("could not read bundle root %s: %w", bundleRoot, err)
	}

	names := make(map[string]bool, len(nameVariants))
	for _, variant := range nameVariants {
		names[strings.ToLower(variant)] = true
	}

	for _, entry := range entries {
		if entry.IsDir() && names[strings.ToLower(entry.Name())] {
			return filepath.Join(bundleRoot, entry.Name()), nil
		}
	}
	return "", fmt.Errorf("folder not found (tried: %s)", strings.Join(nameVariants, ", "))
}

func countMatchingCSVFiles(folderPath string, patterns []string) (int, error) {
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return 0, fmt.Errorf("could not read folder: %w", err)
	}

	count := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".csv") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return 0, err
		}
		if info.Size() == 0 {
			continue
		}
		if len(patterns) == 0 || csvNameMatchesAnyPattern(entry.Name(), patterns) {
			count++
		}
	}
	return count, nil
}

func csvNameMatchesAnyPattern(name string, patterns []string) bool {
	for _, pattern := range patterns {
		if pattern == ".csv" || strings.Contains(name, pattern) {
			return true
		}
	}
	return false
}

// Helper for safe slicing
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}