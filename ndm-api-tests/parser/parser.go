package main

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type TestResults struct {
	Passed   int      `json:"passed"`
	Failed   int      `json:"failed"`
	Skipped  int      `json:"skipped"`
	Failures []string `json:"failures"`
}

type TestSuite struct {
	Name            string      `json:"name"`
	Type            string      `json:"type"`
	SmokeTests      TestResults `json:"smoke_tests"`
	RegressionTests TestResults `json:"regression_tests"`
	E2ETests        TestResults `json:"e2e_tests"`
	TotalPassed     int         `json:"total_passed"`
	TotalFailed     int         `json:"total_failed"`
	TotalSkipped    int         `json:"total_skipped"`
	Status          string      `json:"status"`
	Failures        []string    `json:"failures"`
}

type TestReport struct {
	Timestamp     string     `json:"timestamp"`
	OverallStatus string     `json:"overall_status"`
	Summary       string     `json:"summary"`
	NFSSuite      *TestSuite `json:"nfs_suite,omitempty"`
	SMBSuite      *TestSuite `json:"smb_suite,omitempty"`
	TotalPassed   int        `json:"total_passed"`
	TotalFailed   int        `json:"total_failed"`
	TotalSkipped  int        `json:"total_skipped"`
	TotalTests    int        `json:"total_tests"`
}

func main() {
	// Auto-discover test logs from ../reports directory
	reportsDir := "../reports"

	// Check if reports directory exists
	if _, err := os.Stat(reportsDir); os.IsNotExist(err) {
		// Try alternative paths
		alternativePaths := []string{
			"reports",
			"./reports",
			"../../reports",
		}

		for _, path := range alternativePaths {
			if _, err := os.Stat(path); err == nil {
				reportsDir = path
				break
			}
		}
	}

	fmt.Printf("Auto-discovering test logs from: %s\n", reportsDir)

	// Discover all test logs automatically
	smbLogs, nfsLogs := discoverTestLogs(reportsDir)

	fmt.Printf("Found SMB logs: %d files\n", len(smbLogs))
	fmt.Printf("Found NFS logs: %d files\n", len(nfsLogs))

	report := &TestReport{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	// Parse SMB logs if found
	if len(smbLogs) > 0 {
		fmt.Printf("Parsing SMB test results from %d log files\n", len(smbLogs))
		smbSuite, err := parseTestResultsFromLogs(smbLogs, "SMB")
		if err != nil {
			log.Printf("Error parsing SMB results: %v", err)
		} else {
			report.SMBSuite = smbSuite
		}
	}

	// Parse NFS logs if found
	if len(nfsLogs) > 0 {
		fmt.Printf("Parsing NFS test results from %d log files\n", len(nfsLogs))
		nfsSuite, err := parseTestResultsFromLogs(nfsLogs, "NFS")
		if err != nil {
			log.Printf("Error parsing NFS results: %v", err)
		} else {
			report.NFSSuite = nfsSuite
		}
	}

	if len(smbLogs) == 0 && len(nfsLogs) == 0 {
		fmt.Printf("No test logs found in %s\n", reportsDir)
		// Still generate a report with no results
	}

	calculateOverallStats(report)

	// Always output adaptive card format
	outputAdaptiveCard(report)
}

// discoverTestLogs automatically finds all test log files in the reports directory
func discoverTestLogs(reportsDir string) ([]string, []string) {
	var smbLogs, nfsLogs []string

	// Walk through all subdirectories looking for log files
	err := filepath.Walk(reportsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Continue walking even if there's an error with a specific path
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Only process .log files
		if !strings.HasSuffix(strings.ToLower(info.Name()), ".log") {
			return nil
		}

		// Check if the path contains protocol indicators
		pathLower := strings.ToLower(path)

		// Look for SMB or NFS in the path
		if strings.Contains(pathLower, "smb") {
			// Check if it's a test type we care about
			if strings.Contains(pathLower, "smoke") || strings.Contains(pathLower, "regression") || strings.Contains(pathLower, "end-to-end") || strings.Contains(pathLower, "e2e") {
				smbLogs = append(smbLogs, path)
			}
		} else if strings.Contains(pathLower, "nfs") {
			// Check if it's a test type we care about
			if strings.Contains(pathLower, "smoke") || strings.Contains(pathLower, "regression") || strings.Contains(pathLower, "end-to-end") || strings.Contains(pathLower, "e2e") {
				nfsLogs = append(nfsLogs, path)
			}
		}

		return nil
	})

	if err != nil {
		log.Printf("Error walking directory %s: %v", reportsDir, err)
	}

	// Sort the logs for consistent ordering
	sort.Strings(smbLogs)
	sort.Strings(nfsLogs)

	return smbLogs, nfsLogs
}

// parseTestResultsFromLogs parses multiple log files and combines results
func parseTestResultsFromLogs(logFiles []string, protocol string) (*TestSuite, error) {
	if len(logFiles) == 0 {
		return nil, fmt.Errorf("no log files provided")
	}

	combinedSuite := &TestSuite{
		Name:     protocol + " Tests",
		Type:     strings.ToLower(protocol),
		Failures: []string{},
		SmokeTests: TestResults{
			Failures: []string{},
		},
		RegressionTests: TestResults{
			Failures: []string{},
		},
		E2ETests: TestResults{
			Failures: []string{},
		},
	}

	for _, logFile := range logFiles {
		fmt.Printf("Parsing log file: %s\n", logFile)

		// Determine test type from filename/path
		testType := determineTestType(logFile)

		// Parse this specific log file
		suite, err := parseTestResultsFromPath(logFile, protocol)
		if err != nil {
			log.Printf("Error parsing %s: %v", logFile, err)
			continue
		}

		// Add or merge results based on test type
		if suite != nil {
			switch testType {
			case "smoke":
				combinedSuite.SmokeTests.Passed += suite.SmokeTests.Passed
				combinedSuite.SmokeTests.Failed += suite.SmokeTests.Failed
				combinedSuite.SmokeTests.Skipped += suite.SmokeTests.Skipped
				combinedSuite.SmokeTests.Failures = append(combinedSuite.SmokeTests.Failures, suite.SmokeTests.Failures...)
			case "regression":
				combinedSuite.RegressionTests.Passed += suite.RegressionTests.Passed
				combinedSuite.RegressionTests.Failed += suite.RegressionTests.Failed
				combinedSuite.RegressionTests.Skipped += suite.RegressionTests.Skipped
				combinedSuite.RegressionTests.Failures = append(combinedSuite.RegressionTests.Failures, suite.RegressionTests.Failures...)
			case "end-to-end":
				combinedSuite.E2ETests.Passed += suite.E2ETests.Passed
				combinedSuite.E2ETests.Failed += suite.E2ETests.Failed
				combinedSuite.E2ETests.Skipped += suite.E2ETests.Skipped
				combinedSuite.E2ETests.Failures = append(combinedSuite.E2ETests.Failures, suite.E2ETests.Failures...)
			default:
				// If test type is unclear, add to all categories
				combinedSuite.SmokeTests.Passed += suite.SmokeTests.Passed
				combinedSuite.SmokeTests.Failed += suite.SmokeTests.Failed
				combinedSuite.SmokeTests.Skipped += suite.SmokeTests.Skipped
				combinedSuite.SmokeTests.Failures = append(combinedSuite.SmokeTests.Failures, suite.SmokeTests.Failures...)

				combinedSuite.RegressionTests.Passed += suite.RegressionTests.Passed
				combinedSuite.RegressionTests.Failed += suite.RegressionTests.Failed
				combinedSuite.RegressionTests.Skipped += suite.RegressionTests.Skipped
				combinedSuite.RegressionTests.Failures = append(combinedSuite.RegressionTests.Failures, suite.RegressionTests.Failures...)

				combinedSuite.E2ETests.Passed += suite.E2ETests.Passed
				combinedSuite.E2ETests.Failed += suite.E2ETests.Failed
				combinedSuite.E2ETests.Skipped += suite.E2ETests.Skipped
				combinedSuite.E2ETests.Failures = append(combinedSuite.E2ETests.Failures, suite.E2ETests.Failures...)
			}

			// Add general failures
			combinedSuite.Failures = append(combinedSuite.Failures, suite.Failures...)
		}
	}

	// Calculate totals
	combinedSuite.TotalPassed = combinedSuite.SmokeTests.Passed + combinedSuite.RegressionTests.Passed + combinedSuite.E2ETests.Passed
	combinedSuite.TotalFailed = combinedSuite.SmokeTests.Failed + combinedSuite.RegressionTests.Failed + combinedSuite.E2ETests.Failed
	combinedSuite.TotalSkipped = combinedSuite.SmokeTests.Skipped + combinedSuite.RegressionTests.Skipped + combinedSuite.E2ETests.Skipped

	// Set status
	if combinedSuite.TotalFailed > 0 {
		combinedSuite.Status = "FAILED"
	} else if combinedSuite.TotalPassed > 0 {
		combinedSuite.Status = "PASSED"
	} else {
		combinedSuite.Status = "NO_TESTS"
	}

	return combinedSuite, nil
}

// determineTestType extracts test type from log file path/name
func determineTestType(logPath string) string {
	pathLower := strings.ToLower(logPath)

	if strings.Contains(pathLower, "smoke") {
		return "smoke"
	} else if strings.Contains(pathLower, "regression") {
		return "regression"
	} else if strings.Contains(pathLower, "end-to-end") || strings.Contains(pathLower, "e2e") {
		return "end-to-end"
	}

	return ""
}

func parseTestResultsFromPath(path, testType string) (*TestSuite, error) {
	suite := &TestSuite{
		Name:     testType + " Tests",
		Type:     strings.ToLower(testType),
		Failures: []string{},
		SmokeTests: TestResults{
			Failures: []string{},
		},
		RegressionTests: TestResults{
			Failures: []string{},
		},
		E2ETests: TestResults{
			Failures: []string{},
		},
	}

	if strings.HasSuffix(strings.ToLower(path), ".zip") {
		return parseZipFile(path, suite)
	} else {
		return parseDirectory(path, suite)
	}
}

func parseZipFile(zipPath string, suite *TestSuite) (*TestSuite, error) {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open zip file: %v", err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		if filepath.Ext(file.Name) == ".log" {
			rc, err := file.Open()
			if err != nil {
				continue
			}

			content, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}

			parseGinkgoLogContent(string(content), file.Name, suite)
		}
	}

	calculateSuiteStats(suite)
	return suite, nil
}

func parseDirectory(dirPath string, suite *TestSuite) (*TestSuite, error) {
	err := filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if filepath.Ext(path) == ".log" {
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}

			parseGinkgoLogContent(string(content), filepath.Base(path), suite)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	calculateSuiteStats(suite)
	return suite, nil
}

func stripAnsiCodes(input string) string {
	// Remove ANSI escape sequences
	ansiRegex := regexp.MustCompile(`\x1b\[[0-9;]*m`)
	return ansiRegex.ReplaceAllString(input, "")
}

func parseGinkgoLogContent(content, filename string, suite *TestSuite) {
	lines := strings.Split(content, "\n")

	var testType string
	filenameLower := strings.ToLower(filename)
	if strings.Contains(filenameLower, "smoke") {
		testType = "smoke"
	} else if strings.Contains(filenameLower, "regression") {
		testType = "regression"
	} else if strings.Contains(filenameLower, "end-to-end") || strings.Contains(filenameLower, "e2e") {
		testType = "e2e"
	}

	ginkgoResultPattern := regexp.MustCompile(`SUCCESS! -- (\d+) Passed \| (\d+) Failed \| \d+ Pending \| (\d+) Skipped`)
	ginkgoFailedPattern := regexp.MustCompile(`FAIL! -- (\d+) Passed \| (\d+) Failed \| \d+ Pending \| (\d+) Skipped`)
	failurePattern := regexp.MustCompile(`\[FAIL\] (.+)`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Strip ANSI color codes
		cleanLine := stripAnsiCodes(line)

		if matches := ginkgoResultPattern.FindStringSubmatch(cleanLine); len(matches) >= 4 {
			passed := parseInt(matches[1])
			failed := parseInt(matches[2])
			skipped := parseInt(matches[3])
			updateTestResults(suite, testType, passed, failed, skipped)
		} else if matches := ginkgoFailedPattern.FindStringSubmatch(cleanLine); len(matches) >= 4 {
			passed := parseInt(matches[1])
			failed := parseInt(matches[2])
			skipped := parseInt(matches[3])
			updateTestResults(suite, testType, passed, failed, skipped)
		}

		if matches := failurePattern.FindStringSubmatch(cleanLine); len(matches) >= 2 {
			failure := strings.TrimSpace(matches[1])
			if len(failure) > 200 {
				failure = failure[:200] + "..."
			}
			// Add failure to overall suite list (for backward compatibility)
			suite.Failures = append(suite.Failures, failure)
			// Add failure to specific test type
			updateTestFailures(suite, testType, failure)
		}
	}
}

func updateTestResults(suite *TestSuite, testType string, passed, failed, skipped int) {
	switch testType {
	case "smoke":
		suite.SmokeTests.Passed += passed
		suite.SmokeTests.Failed += failed
		suite.SmokeTests.Skipped += skipped
	case "regression":
		suite.RegressionTests.Passed += passed
		suite.RegressionTests.Failed += failed
		suite.RegressionTests.Skipped += skipped
	case "e2e":
		suite.E2ETests.Passed += passed
		suite.E2ETests.Failed += failed
		suite.E2ETests.Skipped += skipped
	}
}

func updateTestFailures(suite *TestSuite, testType string, failure string) {
	switch testType {
	case "smoke":
		suite.SmokeTests.Failures = append(suite.SmokeTests.Failures, failure)
	case "regression":
		suite.RegressionTests.Failures = append(suite.RegressionTests.Failures, failure)
	case "e2e":
		suite.E2ETests.Failures = append(suite.E2ETests.Failures, failure)
	}
}

func parseInt(s string) int {
	var result int
	fmt.Sscanf(s, "%d", &result)
	return result
}

func calculateSuiteStats(suite *TestSuite) {
	suite.TotalPassed = suite.SmokeTests.Passed + suite.RegressionTests.Passed + suite.E2ETests.Passed
	suite.TotalFailed = suite.SmokeTests.Failed + suite.RegressionTests.Failed + suite.E2ETests.Failed
	suite.TotalSkipped = suite.SmokeTests.Skipped + suite.RegressionTests.Skipped + suite.E2ETests.Skipped

	if suite.TotalFailed == 0 && suite.TotalPassed > 0 {
		suite.Status = "passed"
	} else if suite.TotalFailed > 0 {
		suite.Status = "failed"
	} else {
		suite.Status = "no-results"
	}
}

func calculateOverallStats(report *TestReport) {
	if report.NFSSuite != nil {
		report.TotalPassed += report.NFSSuite.TotalPassed
		report.TotalFailed += report.NFSSuite.TotalFailed
		report.TotalSkipped += report.NFSSuite.TotalSkipped
	}

	if report.SMBSuite != nil {
		report.TotalPassed += report.SMBSuite.TotalPassed
		report.TotalFailed += report.SMBSuite.TotalFailed
		report.TotalSkipped += report.SMBSuite.TotalSkipped
	}

	report.TotalTests = report.TotalPassed + report.TotalFailed + report.TotalSkipped

	if report.TotalFailed == 0 && report.TotalPassed > 0 {
		report.OverallStatus = "✅ All Tests Passed"
		report.Summary = fmt.Sprintf("All %d tests passed successfully", report.TotalPassed)
	} else if report.TotalFailed > 0 {
		report.OverallStatus = "❌ Some Tests Failed"
		report.Summary = fmt.Sprintf("%d tests failed out of %d total tests", report.TotalFailed, report.TotalTests)
	} else {
		report.OverallStatus = "⚠️ No Test Results"
		report.Summary = "No test results found"
	}
}

func outputAdaptiveCard(report *TestReport) {
	fmt.Println("TEST_SUMMARY<<EOF")
	fmt.Println("Test Suites:")
	fmt.Println()

	// Check if we have any suites
	if report.NFSSuite != nil || report.SMBSuite != nil {
		fmt.Println("Smoke Tests -")
		if report.SMBSuite != nil {
			fmt.Printf("SMB: %2d Passed | %2d Failed | %2d Skipped\n",
				report.SMBSuite.SmokeTests.Passed, report.SMBSuite.SmokeTests.Failed, report.SMBSuite.SmokeTests.Skipped)
		}
		if report.NFSSuite != nil {
			fmt.Printf("NFS: %2d Passed | %2d Failed | %2d Skipped\n",
				report.NFSSuite.SmokeTests.Passed, report.NFSSuite.SmokeTests.Failed, report.NFSSuite.SmokeTests.Skipped)
		}

		fmt.Println()
		fmt.Println("Regression Tests -")
		if report.SMBSuite != nil {
			fmt.Printf("SMB: %2d Passed | %2d Failed | %2d Skipped\n",
				report.SMBSuite.RegressionTests.Passed, report.SMBSuite.RegressionTests.Failed, report.SMBSuite.RegressionTests.Skipped)
		}
		if report.NFSSuite != nil {
			fmt.Printf("NFS: %2d Passed | %2d Failed | %2d Skipped\n",
				report.NFSSuite.RegressionTests.Passed, report.NFSSuite.RegressionTests.Failed, report.NFSSuite.RegressionTests.Skipped)
		}

		fmt.Println()
		fmt.Println("End-to-End (E2E) Tests -")
		if report.SMBSuite != nil {
			fmt.Printf("SMB: %2d Passed | %2d Failed | %2d Skipped\n",
				report.SMBSuite.E2ETests.Passed, report.SMBSuite.E2ETests.Failed, report.SMBSuite.E2ETests.Skipped)
		}
		if report.NFSSuite != nil {
			fmt.Printf("NFS: %2d Passed | %2d Failed | %2d Skipped\n",
				report.NFSSuite.E2ETests.Passed, report.NFSSuite.E2ETests.Failed, report.NFSSuite.E2ETests.Skipped)
		}

		// Output failures organized by test type
		hasFailures := false

		// Check if we have any failures in any test type
		if report.SMBSuite != nil {
			hasFailures = hasFailures || len(report.SMBSuite.SmokeTests.Failures) > 0 ||
				len(report.SMBSuite.RegressionTests.Failures) > 0 ||
				len(report.SMBSuite.E2ETests.Failures) > 0
		}
		if report.NFSSuite != nil {
			hasFailures = hasFailures || len(report.NFSSuite.SmokeTests.Failures) > 0 ||
				len(report.NFSSuite.RegressionTests.Failures) > 0 ||
				len(report.NFSSuite.E2ETests.Failures) > 0
		}

		if hasFailures {
			fmt.Println()
			fmt.Println("Failures:")
			fmt.Println()

			// SMOKE failures
			smokeSMBFailures := report.SMBSuite != nil && len(report.SMBSuite.SmokeTests.Failures) > 0
			smokeNFSFailures := report.NFSSuite != nil && len(report.NFSSuite.SmokeTests.Failures) > 0

			if smokeSMBFailures {
				fmt.Println("SMOKE SMB")
				fmt.Println()
				fmt.Printf("Summarizing %d Failure:\n", len(report.SMBSuite.SmokeTests.Failures))
				for _, failure := range report.SMBSuite.SmokeTests.Failures {
					fmt.Printf("[FAIL] %s\n", failure)
				}
				fmt.Println()
			}

			if smokeNFSFailures {
				fmt.Println("SMOKE NFS")
				fmt.Println()
				fmt.Printf("Summarizing %d Failure:\n", len(report.NFSSuite.SmokeTests.Failures))
				for _, failure := range report.NFSSuite.SmokeTests.Failures {
					fmt.Printf("[FAIL] %s\n", failure)
				}
				fmt.Println()
			}

			// REGRESSION failures
			regressionSMBFailures := report.SMBSuite != nil && len(report.SMBSuite.RegressionTests.Failures) > 0
			regressionNFSFailures := report.NFSSuite != nil && len(report.NFSSuite.RegressionTests.Failures) > 0

			if regressionSMBFailures {
				fmt.Println("REGRESSION SMB")
				fmt.Println()
				fmt.Printf("Summarizing %d Failure:\n", len(report.SMBSuite.RegressionTests.Failures))
				for _, failure := range report.SMBSuite.RegressionTests.Failures {
					fmt.Printf("[FAIL] %s\n", failure)
				}
				fmt.Println()
			}

			if regressionNFSFailures {
				fmt.Println("REGRESSION NFS")
				fmt.Println()
				fmt.Printf("Summarizing %d Failure:\n", len(report.NFSSuite.RegressionTests.Failures))
				for _, failure := range report.NFSSuite.RegressionTests.Failures {
					fmt.Printf("[FAIL] %s\n", failure)
				}
				fmt.Println()
			}

			// E2E failures
			e2eSMBFailures := report.SMBSuite != nil && len(report.SMBSuite.E2ETests.Failures) > 0
			e2eNFSFailures := report.NFSSuite != nil && len(report.NFSSuite.E2ETests.Failures) > 0

			if e2eSMBFailures {
				fmt.Println("E2E SMB")
				fmt.Println()
				fmt.Printf("Summarizing %d Failures:\n", len(report.SMBSuite.E2ETests.Failures))
				for _, failure := range report.SMBSuite.E2ETests.Failures {
					fmt.Printf("[FAIL] %s\n", failure)
				}
				fmt.Println()
			}

			if e2eNFSFailures {
				fmt.Println("E2E NFS")
				fmt.Println()
				fmt.Printf("Summarizing %d Failures:\n", len(report.NFSSuite.E2ETests.Failures))
				for _, failure := range report.NFSSuite.E2ETests.Failures {
					fmt.Printf("[FAIL] %s\n", failure)
				}
			}
		}
	}

	fmt.Println("EOF")

	fmt.Printf("TOTAL_PASSED=%d\n", report.TotalPassed)
	fmt.Printf("TOTAL_FAILED=%d\n", report.TotalFailed)
	fmt.Printf("TOTAL_SKIPPED=%d\n", report.TotalSkipped)
	fmt.Printf("TOTAL_TESTS=%d\n", report.TotalTests)
}
