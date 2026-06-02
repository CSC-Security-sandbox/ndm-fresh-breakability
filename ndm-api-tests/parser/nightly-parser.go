package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// GitHub API structures
type GitHubRun struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	Event      string `json:"event"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
	HTMLURL    string `json:"html_url"`
	JobsURL    string `json:"jobs_url"`
}

type GitHubRuns struct {
	WorkflowRuns []GitHubRun `json:"workflow_runs"`
}

type GitHubWorkflow struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type GitHubWorkflows struct {
	Workflows []GitHubWorkflow `json:"workflows"`
}

type GitHubJob struct {
	ID          int    `json:"id"`
	RunID       int    `json:"run_id"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Conclusion  string `json:"conclusion"`
	StartedAt   string `json:"started_at"`
	CompletedAt string `json:"completed_at"`
	HTMLURL     string `json:"html_url"`
	LogsURL     string `json:"logs_url"`
}

type GitHubJobs struct {
	Jobs []GitHubJob `json:"jobs"`
}

// Parsed test result structures
type ParsedTestSuite struct {
	Type     string `json:"type"`
	Protocol string `json:"protocol"`
	Passed   int    `json:"passed"`
	Failed   int    `json:"failed"`
	Pending  int    `json:"pending"`
	Flaked   int    `json:"flaked"`
	Skipped  int    `json:"skipped"`
	Total    int    `json:"total"`
	Status   string `json:"status"`
}

type ParsedTestResults struct {
	Protocol       string            `json:"protocol"`
	TestSuites     []ParsedTestSuite `json:"testSuites"`
	FailureSummary string            `json:"failureSummary"`
}

// Configuration
const (
	owner      = "NetApp-Cloud-DataMigrate"
	repo       = "ndm"
	workflowID = "43693458" // nightly.yml workflow ID
)

// getGitHubToken retrieves GitHub token from environment variable
func getGitHubToken() string {
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		log.Fatal("GITHUB_TOKEN environment variable is required")
	}
	return token
}

// outputGitHubActionsFormat outputs data in GitHub Actions output format for workflow consumption
func outputGitHubActionsFormat(results map[string]*ParsedTestResults, runURL, summary string) {
	// Calculate totals
	totalPassed := 0
	totalFailed := 0
	totalPending := 0
	totalFlaked := 0
	totalSkipped := 0
	totalTests := 0

	for _, result := range results {
		for _, suite := range result.TestSuites {
			totalPassed += suite.Passed
			totalFailed += suite.Failed
			totalPending += suite.Pending
			totalFlaked += suite.Flaked
			totalSkipped += suite.Skipped
			totalTests += suite.Total
		}
	}

	// Output in GitHub Actions format that can be captured as outputs
	fmt.Printf("TOTAL_TESTS=%d\n", totalTests)
	fmt.Printf("TOTAL_PASSED=%d\n", totalPassed)
	fmt.Printf("TOTAL_FAILED=%d\n", totalFailed)
	fmt.Printf("TOTAL_PENDING=%d\n", totalPending)
	fmt.Printf("TOTAL_FLAKED=%d\n", totalFlaked)
	fmt.Printf("TOTAL_SKIPPED=%d\n", totalSkipped)
	fmt.Printf("PIPELINE_URL=%s\n", runURL)

	// Status based on failures
	status := "success"
	if totalFailed > 0 {
		status = "failure"
	}
	fmt.Printf("TEST_STATUS=%s\n", status)

	// Output individual test result lines for Teams card building
	testTypes := []string{"smoke", "e2e", "regression"}
	protocols := []string{"SMB", "NFS"}

	for _, testType := range testTypes {
		for _, protocol := range protocols {
			for _, result := range results {
				for _, suite := range result.TestSuites {
					if suite.Type == testType && suite.Protocol == protocol {
						// Output formatted line for this test suite
						fmt.Printf("%s_%s_LINE=%s: %2d Passed | %2d Failed | %2d Pending | %2d Flaked | %2d Skipped\n",
							strings.ToUpper(testType), strings.ToUpper(protocol),
							suite.Protocol, suite.Passed, suite.Failed, suite.Pending, suite.Flaked, suite.Skipped)
					}
				}
			}
		}
	}

	// Output individual failure summaries for Teams card
	outputFailureSummaries(results)
}

// outputFailureSummaries generates individual failure summary outputs for Teams card
func outputFailureSummaries(results map[string]*ParsedTestResults) {
	testTypes := []string{"smoke", "e2e", "regression"}
	protocols := []string{"SMB", "NFS"}
	
	// Track what we've already output to prevent duplicates
	outputted := make(map[string]bool)

	for _, testType := range testTypes {
		for _, protocol := range protocols {
			key := testType + "_" + protocol
			
			// Skip if we've already output this combination
			if outputted[key] {
				continue
			}
			
			// Find the first result that has failures for this test type and protocol
			for _, result := range results {
				for _, suite := range result.TestSuites {
					if suite.Type == testType && suite.Protocol == protocol && suite.Failed > 0 && result.FailureSummary != "" {
						testTypeName := testType
						if testType == "e2e" {
							testTypeName = "E2E"
						} else {
							testTypeName = strings.ToUpper(testType)
						}
						
						// Output failure summary for this specific test type and protocol
						// Ensure the failure summary ends with a newline to prevent EOF concatenation
						failureSummary := strings.TrimSpace(result.FailureSummary)
						fmt.Printf("%s_%s_FAILURE<<EOF\n%s %s\n\n%s\nEOF\n", 
							strings.ToUpper(testType), strings.ToUpper(protocol), 
							testTypeName, suite.Protocol, failureSummary)
						
						// Mark this combination as outputted
						outputted[key] = true
						
						// Break out of both loops to avoid duplicates
						goto nextCombination
					}
				}
			}
			nextCombination:
		}
	}
}

func main() {
	log.Println("=== Nightly Test Parser Started ===")

	// Find the latest nightly run
	run, err := findLatestNightlyRun()
	if err != nil {
		log.Fatalf("Error finding latest nightly run: %v", err)
	}

	log.Printf("Found latest nightly run: %s (ID: %d)", run.HTMLURL, run.ID)

	// Download test logs from jobs
	testResults, err := downloadTestLogsFromJobs(run)
	if err != nil {
		log.Fatalf("Error downloading test logs: %v", err)
	}

	// Generate summary
	summary := generateTestSummary(testResults, run.HTMLURL)

	// Output clean summary for GitHub Actions to capture
	fmt.Println("TEST_SUMMARY_START")
	fmt.Println(summary)
	fmt.Println("TEST_SUMMARY_END")

	// Output structured data as JSON for programmatic use
	jsonResults, err := json.MarshalIndent(testResults, "", "  ")
	if err != nil {
		log.Printf("Warning: Failed to marshal results to JSON: %v", err)
	} else {
		fmt.Println("JSON_RESULTS_START")
		fmt.Println(string(jsonResults))
		fmt.Println("JSON_RESULTS_END")
	}

	// Output GitHub Actions format for workflow consumption
	outputGitHubActionsFormat(testResults, run.HTMLURL, summary)

	log.Println("=== Nightly Test Parser Completed ===")
}

// findLatestNightlyRun finds the most recent scheduled nightly run using dashboard logic
func findLatestNightlyRun() (*GitHubRun, error) {
	// First, get workflows to find the NDM VM Image Build workflow
	workflowsURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/workflows", owner, repo)

	req, err := http.NewRequest("GET", workflowsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create workflows request: %v", err)
	}

	req.Header.Set("Authorization", "token "+getGitHubToken())
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get workflows: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}

	var workflows GitHubWorkflows
	if err := json.NewDecoder(resp.Body).Decode(&workflows); err != nil {
		return nil, fmt.Errorf("failed to decode workflows response: %v", err)
	}

	// Find the NDM VM Image Build workflow (same logic as dashboard)
	var ndmWorkflow *GitHubWorkflow
	for _, workflow := range workflows.Workflows {
		if workflow.Name == "NDM VM Image Build" || strings.Contains(workflow.Name, "NDM VM Image") {
			ndmWorkflow = &workflow
			break
		}
	}

	if ndmWorkflow == nil {
		return nil, fmt.Errorf("NDM VM Image Build workflow not found")
	}

	log.Printf("Found NDM VM Image Build workflow: %s (ID: %d)", ndmWorkflow.Name, ndmWorkflow.ID)

	// Now get runs for this specific workflow
	runsURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/workflows/%d/runs?event=schedule&per_page=20", owner, repo, ndmWorkflow.ID)

	req, err = http.NewRequest("GET", runsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create runs request: %v", err)
	}

	req.Header.Set("Authorization", "token "+getGitHubToken())
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err = client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get runs: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}

	var runs GitHubRuns
	if err := json.NewDecoder(resp.Body).Decode(&runs); err != nil {
		return nil, fmt.Errorf("failed to decode runs response: %v", err)
	}

	if len(runs.WorkflowRuns) == 0 {
		return nil, fmt.Errorf("no scheduled runs found for NDM VM Image Build workflow")
	}

	// Return the most recent scheduled run
	latestRun := &runs.WorkflowRuns[0]
	log.Printf("Latest NDM VM Image Build run: %s (Status: %s, Conclusion: %s)", latestRun.HTMLURL, latestRun.Status, latestRun.Conclusion)

	return latestRun, nil
}

// downloadTestLogsFromJobs downloads test logs from workflow jobs using GitHub API
func downloadTestLogsFromJobs(run *GitHubRun) (map[string]*ParsedTestResults, error) {
	// Get jobs for the workflow run
	jobsURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/runs/%d/jobs", owner, repo, run.ID)

	req, err := http.NewRequest("GET", jobsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create jobs request: %v", err)
	}

	req.Header.Set("Authorization", "token "+getGitHubToken())
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get jobs: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}

	var jobs GitHubJobs
	if err := json.NewDecoder(resp.Body).Decode(&jobs); err != nil {
		return nil, fmt.Errorf("failed to decode jobs response: %v", err)
	}

	log.Printf("Found %d jobs in workflow run", len(jobs.Jobs))

	// Process each job to find test jobs
	results := make(map[string]*ParsedTestResults)

	for _, job := range jobs.Jobs {
		// Skip jobs that aren't test jobs (like setup, build, etc.)
		if !isTestJob(job.Name) {
			log.Printf("Skipping non-test job: %s", job.Name)
			continue
		}

		log.Printf("Processing test job: %s", job.Name)

		// Download job logs
		logs, err := downloadJobLogs(job.ID)
		if err != nil {
			log.Printf("Warning: Failed to download logs for job %s: %v", job.Name, err)
			continue
		}

		// Parse test results from logs
		testResults := parseTestLogsFromContent(logs, job.Name)
		if testResults != nil && len(testResults.TestSuites) > 0 {
			results[job.Name] = testResults
			log.Printf("Parsed %d test suites from job %s", len(testResults.TestSuites), job.Name)
		} else {
			log.Printf("No test results found in job %s", job.Name)
		}
	}

	return results, nil
}

// isTestJob determines if a job is a test job based on its name
func isTestJob(jobName string) bool {
	testJobPatterns := []string{
		"SMB",
		"NFS",
		"test",
		"smoke",
		"regression",
		"e2e",
		"end-to-end",
	}

	jobNameLower := strings.ToLower(jobName)
	for _, pattern := range testJobPatterns {
		if strings.Contains(jobNameLower, strings.ToLower(pattern)) {
			return true
		}
	}

	return false
}

// downloadJobLogs downloads logs for a specific job
func downloadJobLogs(jobID int) (string, error) {
	logsURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/jobs/%d/logs", owner, repo, jobID)

	req, err := http.NewRequest("GET", logsURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create logs request: %v", err)
	}

	req.Header.Set("Authorization", "token "+getGitHubToken())
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get logs: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read logs: %v", err)
	}

	return string(body), nil
}

// parseTestLogsFromContent implements the same parsing logic as test-analyzer.txt
func parseTestLogsFromContent(logs, jobName string) *ParsedTestResults {
	protocol := "UNKNOWN"
	if strings.Contains(jobName, "SMB") {
		protocol = "SMB"
	} else if strings.Contains(jobName, "NFS") {
		protocol = "NFS"
	}

	testSuites := []ParsedTestSuite{}

	// Split logs into lines and clean them
	lines := strings.Split(logs, "\n")
	cleanedLines := make([]string, 0)
	for _, line := range lines {
		// Remove GitHub Actions timestamp format: 2025-09-15T20:44:44.8843585Z
		cleaned := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z\s*`).ReplaceAllString(line, "")
		// Remove ANSI color codes
		cleaned = regexp.MustCompile(`\x1B\[[0-9;]*m`).ReplaceAllString(cleaned, "")
		cleaned = strings.TrimSpace(cleaned)
		if cleaned != "" {
			cleanedLines = append(cleanedLines, cleaned)
		}
	}

	// Find all test suite start positions
	suiteStarts := []struct {
		line     int
		testType string
	}{}

	for i, line := range cleanedLines {
		if strings.Contains(line, "Starting smoke tests") {
			suiteStarts = append(suiteStarts, struct {
				line     int
				testType string
			}{line: i, testType: "smoke"})
		} else if strings.Contains(line, "Starting end-to-end tests") {
			suiteStarts = append(suiteStarts, struct {
				line     int
				testType string
			}{line: i, testType: "e2e"})
		} else if strings.Contains(line, "Starting regression tests") {
			suiteStarts = append(suiteStarts, struct {
				line     int
				testType string
			}{line: i, testType: "regression"})
		}
	}

	// Process each suite
	for i, start := range suiteStarts {
		end := len(cleanedLines)
		if i+1 < len(suiteStarts) {
			end = suiteStarts[i+1].line
		}
		suiteLines := cleanedLines[start.line:end]

		suite := parseSuiteFromLines(suiteLines, start.testType, protocol)
		if suite != nil {
			testSuites = append(testSuites, *suite)
		}
	}

	// Extract failure summary
	failureSummary := extractFailureSummaryFromLines(cleanedLines)

	return &ParsedTestResults{
		Protocol:       protocol,
		TestSuites:     testSuites,
		FailureSummary: failureSummary,
	}
}

// parseSuiteFromLines parses a single test suite from log lines
func parseSuiteFromLines(lines []string, suiteType, protocol string) *ParsedTestSuite {
	// Look for test completion patterns
	for i, line := range lines {
		// First look for the "Ran X of Y Specs" line to get context
		if matched := regexp.MustCompile(`Ran (\d+) of (\d+) Specs in ([\d.]+) seconds`).FindStringSubmatch(line); matched != nil {
			// Look for the next line which should have the results
			if i+1 < len(lines) {
				nextLine := lines[i+1]

				// Match SUCCESS pattern. Ginkgo optionally inserts a "Flaked" column when
				// specs were retried, e.g.:
				//   SUCCESS! -- 8 Passed | 0 Failed | 0 Pending | 0 Skipped
				//   SUCCESS! -- 14 Passed | 0 Failed | 1 Flaked | 0 Pending | 7 Skipped
				if successMatch := regexp.MustCompile(`SUCCESS!\s*--\s*(\d+)\s*Passed\s*\|\s*(\d+)\s*Failed\s*\|\s*(?:(\d+)\s*Flaked\s*\|\s*)?(\d+)\s*Pending\s*\|\s*(\d+)\s*Skipped`).FindStringSubmatch(nextLine); successMatch != nil {
					passed, _ := strconv.Atoi(successMatch[1])
					failed, _ := strconv.Atoi(successMatch[2])
					flaked, _ := strconv.Atoi(successMatch[3]) // empty group -> 0
					pending, _ := strconv.Atoi(successMatch[4])
					skipped, _ := strconv.Atoi(successMatch[5])
					// Flaked specs are already counted within Passed, so they are not added to Total.
					total := passed + failed + pending + skipped

					return &ParsedTestSuite{
						Type:     suiteType,
						Protocol: protocol,
						Passed:   passed,
						Failed:   failed,
						Pending:  pending,
						Flaked:   flaked,
						Skipped:  skipped,
						Total:    total,
						Status:   "completed",
					}
				}

				// Match FAILURE pattern. Same optional "Flaked" column as above:
				//   FAIL! -- X Passed | Y Failed | Z Pending | W Skipped
				//   FAIL! -- X Passed | Y Failed | F Flaked | Z Pending | W Skipped
				if failMatch := regexp.MustCompile(`FAIL!\s*--\s*(\d+)\s*Passed\s*\|\s*(\d+)\s*Failed\s*\|\s*(?:(\d+)\s*Flaked\s*\|\s*)?(\d+)\s*Pending\s*\|\s*(\d+)\s*Skipped`).FindStringSubmatch(nextLine); failMatch != nil {
					passed, _ := strconv.Atoi(failMatch[1])
					failed, _ := strconv.Atoi(failMatch[2])
					flaked, _ := strconv.Atoi(failMatch[3]) // empty group -> 0
					pending, _ := strconv.Atoi(failMatch[4])
					skipped, _ := strconv.Atoi(failMatch[5])
					total := passed + failed + pending + skipped

					return &ParsedTestSuite{
						Type:     suiteType,
						Protocol: protocol,
						Passed:   passed,
						Failed:   failed,
						Pending:  pending,
						Flaked:   flaked,
						Skipped:  skipped,
						Total:    total,
						Status:   "failed",
					}
				}
			}
		}
	}

	return nil
}

// extractFailureSummaryFromLines extracts failure summaries from log lines using test-analyser logic
func extractFailureSummaryFromLines(lines []string) string {
	failureSummaries := make(map[string]string)

	// Look for "Summarizing X Failures:" pattern - find ALL occurrences
	for i := 0; i < len(lines); i++ {
		line := lines[i]

		if regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(line) {
			// Found the start of failure summary
			summaryLines := []string{line}
			lastProcessedIndex := i

			// Collect all the failure details that follow
			for j := i + 1; j < len(lines); j++ {
				nextLine := lines[j]
				lastProcessedIndex = j

				// Stop if we hit another "Summarizing" line (next failure summary)
				if regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(nextLine) {
					lastProcessedIndex = j - 1
					break
				}

				// Stop if we hit an empty line followed by non-failure content
				if nextLine == "" && j+1 < len(lines) &&
					!regexp.MustCompile(`\[FAIL\]|\/home\/ubuntu`).MatchString(lines[j+1]) &&
					!regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(lines[j+1]) {
					break
				}

				// Include failure lines: [FAIL] lines and file paths
				if regexp.MustCompile(`\[FAIL\]`).MatchString(nextLine) ||
					regexp.MustCompile(`\/home\/ubuntu\/actions-runner\/_work\/ndm\/ndm\/ndm-api-tests\/tests\/`).MatchString(nextLine) ||
					nextLine == "" {
					summaryLines = append(summaryLines, nextLine)
				} else if len(summaryLines) > 1 &&
					!regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(nextLine) {
					// We've collected failure info and hit something else (but not another summary), stop
					break
				}
			}

			if len(summaryLines) > 1 {
				fullSummary := strings.Join(summaryLines, "\n")

				// Determine test suite based on the actual failure content
				testSuite := "unknown"

				// Check the file paths in the failure summary to determine test suite
				summaryText := strings.ToLower(fullSummary)
				if strings.Contains(summaryText, "/tests/e2e/") || strings.Contains(summaryText, "e2e test") {
					testSuite = "e2e"
				} else if strings.Contains(summaryText, "/tests/smoke/") || strings.Contains(summaryText, "smoke test") {
					testSuite = "smoke"
				} else if strings.Contains(summaryText, "/tests/regression/") || strings.Contains(summaryText, "regression test") {
					testSuite = "regression"
				} else {
					// Fallback: Look backward in logs to find the test suite context
					for k := i - 1; k >= 0 && k >= i-50; k-- {
						contextLine := strings.ToLower(lines[k])
						if strings.Contains(contextLine, "running e2e tests") ||
							strings.Contains(contextLine, "e2e test") ||
							strings.Contains(contextLine, "starting end-to-end tests") {
							testSuite = "e2e"
							break
						} else if strings.Contains(contextLine, "running smoke tests") ||
							strings.Contains(contextLine, "smoke test") ||
							strings.Contains(contextLine, "starting smoke tests") {
							testSuite = "smoke"
							break
						} else if strings.Contains(contextLine, "running regression tests") ||
							strings.Contains(contextLine, "regression test") ||
							strings.Contains(contextLine, "starting regression tests") {
							testSuite = "regression"
							break
						}
					}
				}

				// If we already have a summary for this test suite, append to it
				if existing, exists := failureSummaries[testSuite]; exists {
					failureSummaries[testSuite] = existing + "\n\n" + strings.TrimSpace(fullSummary)
				} else {
					failureSummaries[testSuite] = strings.TrimSpace(fullSummary)
				}

				// Continue looking for more failure summaries instead of breaking
				i = lastProcessedIndex // Move index to continue searching from where we left off
			}
		}
	}

	// Convert map to single string format for backwards compatibility
	// but prioritize e2e failures as they're most common
	if e2eFailures, exists := failureSummaries["e2e"]; exists {
		return e2eFailures
	}

	// If no e2e failures, return any other failures
	for _, failures := range failureSummaries {
		return failures
	}

	return ""
}

// generateTestSummary generates a summary of test results with failure details
func generateTestSummary(results map[string]*ParsedTestResults, runURL string) string {
	var summary strings.Builder

	summary.WriteString(fmt.Sprintf("Pipeline: %s\n\n", runURL))
	summary.WriteString("Test Suites:\n\n")

	// Organize by test type
	testTypes := []string{"smoke", "e2e", "regression"}

	for _, testType := range testTypes {
		found := false
		testTypeName := testType
		if testType == "e2e" {
			testTypeName = "E2E"
		} else {
			testTypeName = strings.ToUpper(testType[:1]) + testType[1:]
		}
		summary.WriteString(fmt.Sprintf("%s Tests -\n", testTypeName))

		// Group by protocol within each test type
		protocols := []string{"SMB", "NFS"}
		for _, protocol := range protocols {
			for _, result := range results {
				for _, suite := range result.TestSuites {
					if suite.Type == testType && suite.Protocol == protocol {
						summary.WriteString(fmt.Sprintf("  %s: %d Passed | %d Failed | %d Pending | %d Flaked | %d Skipped\n",
							suite.Protocol, suite.Passed, suite.Failed, suite.Pending, suite.Flaked, suite.Skipped))
						found = true
					}
				}
			}
		}

		if !found {
			summary.WriteString("  No results found\n")
		}
		summary.WriteString("\n")
	}

	// Calculate totals
	totalPassed := 0
	totalFailed := 0
	totalPending := 0
	totalFlaked := 0
	totalSkipped := 0
	totalTests := 0

	for _, result := range results {
		for _, suite := range result.TestSuites {
			totalPassed += suite.Passed
			totalFailed += suite.Failed
			totalPending += suite.Pending
			totalFlaked += suite.Flaked
			totalSkipped += suite.Skipped
			totalTests += suite.Total
		}
	}

	summary.WriteString(fmt.Sprintf("Total: %d tests, %d passed, %d failed, %d pending, %d flaked, %d skipped\n",
		totalTests, totalPassed, totalFailed, totalPending, totalFlaked, totalSkipped))

	// Add failure details section if there are failures
	if totalFailed > 0 {
		summary.WriteString("\n\nFailures:\n\n")

		for _, testType := range testTypes {
			// Check for failures in each protocol for this test type
			for _, result := range results {
				for _, suite := range result.TestSuites {
					if suite.Type == testType && suite.Failed > 0 && result.FailureSummary != "" {
						testTypeName := testType
						if testType == "e2e" {
							testTypeName = "E2E"
						} else {
							testTypeName = strings.ToUpper(testType)
						}
						summary.WriteString(fmt.Sprintf("%s %s\n\n", testTypeName, suite.Protocol))
						summary.WriteString(result.FailureSummary)
						summary.WriteString("\n\n")
					}
				}
			}
		}
	}

	return summary.String()
}
