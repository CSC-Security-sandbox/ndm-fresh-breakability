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

type ParsedTestSuite struct {
	Type     string `json:"type"`
	Protocol string `json:"protocol"`
	Passed   int    `json:"passed"`
	Failed   int    `json:"failed"`
	Pending  int    `json:"pending"`
	Skipped  int    `json:"skipped"`
	Total    int    `json:"total"`
	Status   string `json:"status"`
}

type ParsedTestResults struct {
	Protocol       string            `json:"protocol"`
	TestSuites     []ParsedTestSuite `json:"testSuites"`
	FailureSummary string            `json:"failureSummary"`
}

const (
	owner      = "NetApp-Cloud-DataMigrate"
	repo       = "ndm"
	workflowID = "43693458"
)

func getGitHubToken() string {
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		log.Fatal("GITHUB_TOKEN environment variable is required")
	}
	return token
}

func outputGitHubActionsFormat(results map[string]*ParsedTestResults, runURL, summary string) {

	totalPassed := 0
	totalFailed := 0
	totalSkipped := 0
	totalTests := 0

	for _, result := range results {
		for _, suite := range result.TestSuites {
			totalPassed += suite.Passed
			totalFailed += suite.Failed
			totalSkipped += suite.Skipped
			totalTests += suite.Total
		}
	}

	fmt.Printf("TOTAL_TESTS=%d\n", totalTests)
	fmt.Printf("TOTAL_PASSED=%d\n", totalPassed)
	fmt.Printf("TOTAL_FAILED=%d\n", totalFailed)
	fmt.Printf("TOTAL_SKIPPED=%d\n", totalSkipped)
	fmt.Printf("PIPELINE_URL=%s\n", runURL)

	status := "success"
	if totalFailed > 0 {
		status = "failure"
	}
	fmt.Printf("TEST_STATUS=%s\n", status)
}

func main() {
	log.Println("=== Nightly Test Parser Started ===")

	run, err := findLatestNightlyRun()
	if err != nil {
		log.Fatalf("Error finding latest nightly run: %v", err)
	}

	log.Printf("Found latest nightly run: %s (ID: %d)", run.HTMLURL, run.ID)

	testResults, err := downloadTestLogsFromJobs(run)
	if err != nil {
		log.Fatalf("Error downloading test logs: %v", err)
	}

	summary := generateTestSummary(testResults, run.HTMLURL)

	fmt.Println("TEST_SUMMARY_START")
	fmt.Println(summary)
	fmt.Println("TEST_SUMMARY_END")

	jsonResults, err := json.MarshalIndent(testResults, "", "  ")
	if err != nil {
		log.Printf("Warning: Failed to marshal results to JSON: %v", err)
	} else {
		fmt.Println("JSON_RESULTS_START")
		fmt.Println(string(jsonResults))
		fmt.Println("JSON_RESULTS_END")
	}

	outputGitHubActionsFormat(testResults, run.HTMLURL, summary)

	log.Println("=== Nightly Test Parser Completed ===")
}

func findLatestNightlyRun() (*GitHubRun, error) {
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

	latestRun := &runs.WorkflowRuns[0]
	log.Printf("Latest NDM VM Image Build run: %s (Status: %s, Conclusion: %s)", latestRun.HTMLURL, latestRun.Status, latestRun.Conclusion)

	return latestRun, nil
}

func downloadTestLogsFromJobs(run *GitHubRun) (map[string]*ParsedTestResults, error) {

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

	results := make(map[string]*ParsedTestResults)

	for _, job := range jobs.Jobs {
		if !isTestJob(job.Name) {
			log.Printf("Skipping non-test job: %s", job.Name)
			continue
		}

		log.Printf("Processing test job: %s", job.Name)

		logs, err := downloadJobLogs(job.ID)
		if err != nil {
			log.Printf("Warning: Failed to download logs for job %s: %v", job.Name, err)
			continue
		}

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

func parseTestLogsFromContent(logs, jobName string) *ParsedTestResults {
	protocol := "UNKNOWN"
	if strings.Contains(jobName, "SMB") {
		protocol = "SMB"
	} else if strings.Contains(jobName, "NFS") {
		protocol = "NFS"
	}

	testSuites := []ParsedTestSuite{}

	lines := strings.Split(logs, "\n")
	cleanedLines := make([]string, 0)
	for _, line := range lines {
		cleaned := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z\s*`).ReplaceAllString(line, "")

		cleaned = regexp.MustCompile(`\x1B\[[0-9;]*m`).ReplaceAllString(cleaned, "")
		cleaned = strings.TrimSpace(cleaned)
		if cleaned != "" {
			cleanedLines = append(cleanedLines, cleaned)
		}
	}

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

	failureSummary := extractFailureSummaryFromLines(cleanedLines)

	return &ParsedTestResults{
		Protocol:       protocol,
		TestSuites:     testSuites,
		FailureSummary: failureSummary,
	}
}

func parseSuiteFromLines(lines []string, suiteType, protocol string) *ParsedTestSuite {
	for i, line := range lines {
		if matched := regexp.MustCompile(`Ran (\d+) of (\d+) Specs in ([\d.]+) seconds`).FindStringSubmatch(line); matched != nil {

			if i+1 < len(lines) {
				nextLine := lines[i+1]

				if successMatch := regexp.MustCompile(`SUCCESS!\s*--\s*(\d+)\s*Passed\s*\|\s*(\d+)\s*Failed\s*\|\s*(\d+)\s*Pending\s*\|\s*(\d+)\s*Skipped`).FindStringSubmatch(nextLine); successMatch != nil {
					passed, _ := strconv.Atoi(successMatch[1])
					failed, _ := strconv.Atoi(successMatch[2])
					pending, _ := strconv.Atoi(successMatch[3])
					skipped, _ := strconv.Atoi(successMatch[4])
					total := passed + failed + pending + skipped

					return &ParsedTestSuite{
						Type:     suiteType,
						Protocol: protocol,
						Passed:   passed,
						Failed:   failed,
						Pending:  pending,
						Skipped:  skipped,
						Total:    total,
						Status:   "completed",
					}
				}

				if failMatch := regexp.MustCompile(`FAIL!\s*--\s*(\d+)\s*Passed\s*\|\s*(\d+)\s*Failed\s*\|\s*(\d+)\s*Pending\s*\|\s*(\d+)\s*Skipped`).FindStringSubmatch(nextLine); failMatch != nil {
					passed, _ := strconv.Atoi(failMatch[1])
					failed, _ := strconv.Atoi(failMatch[2])
					pending, _ := strconv.Atoi(failMatch[3])
					skipped, _ := strconv.Atoi(failMatch[4])
					total := passed + failed + pending + skipped

					return &ParsedTestSuite{
						Type:     suiteType,
						Protocol: protocol,
						Passed:   passed,
						Failed:   failed,
						Pending:  pending,
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

func extractFailureSummaryFromLines(lines []string) string {
	failureSummaries := make(map[string]string)
	for i := 0; i < len(lines); i++ {
		line := lines[i]

		if regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(line) {
			summaryLines := []string{line}
			lastProcessedIndex := i

			for j := i + 1; j < len(lines); j++ {
				nextLine := lines[j]
				lastProcessedIndex = j

				if regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(nextLine) {
					lastProcessedIndex = j - 1
					break
				}

				if nextLine == "" && j+1 < len(lines) &&
					!regexp.MustCompile(`\[FAIL\]|\/home\/ubuntu`).MatchString(lines[j+1]) &&
					!regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(lines[j+1]) {
					break
				}

				if regexp.MustCompile(`\[FAIL\]`).MatchString(nextLine) ||
					regexp.MustCompile(`\/home\/ubuntu\/actions-runner\/_work\/ndm\/ndm\/ndm-api-tests\/tests\/`).MatchString(nextLine) ||
					nextLine == "" {
					summaryLines = append(summaryLines, nextLine)
				} else if len(summaryLines) > 1 &&
					!regexp.MustCompile(`Summarizing \d+ Failures?:`).MatchString(nextLine) {
					break
				}
			}

			if len(summaryLines) > 1 {
				fullSummary := strings.Join(summaryLines, "\n")

				testSuite := "unknown"

				summaryText := strings.ToLower(fullSummary)
				if strings.Contains(summaryText, "/tests/e2e/") || strings.Contains(summaryText, "e2e test") {
					testSuite = "e2e"
				} else if strings.Contains(summaryText, "/tests/smoke/") || strings.Contains(summaryText, "smoke test") {
					testSuite = "smoke"
				} else if strings.Contains(summaryText, "/tests/regression/") || strings.Contains(summaryText, "regression test") {
					testSuite = "regression"
				} else {
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

				if existing, exists := failureSummaries[testSuite]; exists {
					failureSummaries[testSuite] = existing + "\n\n" + strings.TrimSpace(fullSummary)
				} else {
					failureSummaries[testSuite] = strings.TrimSpace(fullSummary)
				}

				i = lastProcessedIndex
			}
		}
	}

	if e2eFailures, exists := failureSummaries["e2e"]; exists {
		return e2eFailures
	}

	for _, failures := range failureSummaries {
		return failures
	}

	return ""
}

func generateTestSummary(results map[string]*ParsedTestResults, runURL string) string {
	var summary strings.Builder

	summary.WriteString(fmt.Sprintf("Pipeline: %s\n\n", runURL))
	summary.WriteString("Test Suites:\n\n")

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

		protocols := []string{"SMB", "NFS"}
		for _, protocol := range protocols {
			for _, result := range results {
				for _, suite := range result.TestSuites {
					if suite.Type == testType && suite.Protocol == protocol {
						summary.WriteString(fmt.Sprintf("  %s: %d Passed | %d Failed | %d Skipped\n",
							suite.Protocol, suite.Passed, suite.Failed, suite.Skipped))
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

	totalPassed := 0
	totalFailed := 0
	totalSkipped := 0
	totalTests := 0

	for _, result := range results {
		for _, suite := range result.TestSuites {
			totalPassed += suite.Passed
			totalFailed += suite.Failed
			totalSkipped += suite.Skipped
			totalTests += suite.Total
		}
	}

	summary.WriteString(fmt.Sprintf("Total: %d tests, %d passed, %d failed\n", totalTests, totalPassed, totalFailed))

	if totalFailed > 0 {
		summary.WriteString("\n\nFailures:\n\n")

		for _, testType := range testTypes {
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
