package utils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"time"

	. "github.com/onsi/gomega"
)

type GetJobResponse struct {
	JobRuns []struct {
		JobRunId string `json:"jobRunId"`
		Status   string `json:"status"`
	} `json:"jobRuns"`
}

type JobResponse []struct {
	ID string `json:"id"`
}

type BulkCutoverJobParams struct {
	SourcePathIDs      []string
	DestinationPathIDs []string
}

// JobCounts holds the counts of directories and files.
type JobCounts struct {
	DirectoryCount string
	FileCount      string
}

// JobRunStatus represents the status of a job run.
type JobRunStatus struct {
	Status                  string `json:"status"`
	ScannedDirectoriesCount string `json:"scannedDirectoriesCount"`
	ScannedFilesCount       string `json:"scannedFilesCount"`
}

// JobRunStatusResponse is the response from the job status API.
type JobRunStatusResponse struct {
	JobRuns []JobRunStatus `json:"jobRuns"`
}

type JobStatus struct {
	Status string `json:"status"`
}


func CheckResponse(resp *http.Response, expected int) {
	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading response body: %v\n", err)
	}

	resp.Body = ioutil.NopCloser(bytes.NewReader(bodyBytes))
	if resp.StatusCode != expected {
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			fmt.Printf("Expected status %d, but got %d. Response body: %s\n", expected, resp.StatusCode, string(bodyBytes))
		} else {
			fmt.Printf("Expected status %d, but got %d.\n", expected, resp.StatusCode)
		}
	}
	Expect(resp.StatusCode).To(Equal(expected))
}

type DiscoveryJobParams struct {
	SourcePathIDs            []string
	ExcludeOlderThan         interface{}
	ExcludeFilePatterns      string
	PreserveAccessTime       bool
	FirstRunAt               string
	CreatedBy                interface{}
	WorkflowExecutionTimeout string
	WorkflowTaskTimeout      string
	WorkflowRunTimeout       string
	StartDelay               string

	Extra map[string]interface{}
}

func CreateDiscoveryJob(params DiscoveryJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createDiscoveryURL := JOB_SERVICE_URL + "/api/v1/jobs/bulk-discovery"

	payload := map[string]interface{}{
		"excludeOlderThan":    params.ExcludeOlderThan,
		"excludeFilePatterns": params.ExcludeFilePatterns,
		"preserveAccessTime":  params.PreserveAccessTime,
		"firstRunAt":          params.FirstRunAt,
		"sourcePathIds":       params.SourcePathIDs,
		"createdBy":           params.CreatedBy,
		"options": map[string]interface{}{
			"workflowExecutionTimeout": params.WorkflowExecutionTimeout,
			"workflowTaskTimeout":      params.WorkflowTaskTimeout,
			"workflowRunTimeout":       params.WorkflowRunTimeout,
			"startDelay":               params.StartDelay,
		},
	}

	if params.Extra != nil {
		for key, value := range params.Extra {
			payload[key] = value
		}
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createDiscoveryURL, payloadBytes, headers)
	if err != nil {
		return nil, nil, err
	}

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, resp, err
	}

	var jobDestResp JobResponse
	err = json.Unmarshal(bodyBytes, &jobDestResp)
	if err != nil {
		return nil, resp, err
	}

	// Collect all job config IDs
	var jobConfigIDs []string
	for _, job := range jobDestResp {
		if job.ID != "" {
			jobConfigIDs = append(jobConfigIDs, job.ID)
		}
	}

	return jobConfigIDs, resp, nil
}

type MigrationJobParams struct {
	FirstRunAt         string
	FutureRunSchedule  string
	SourcePathIDs      []string
	DestinationPathIDs []string
	SidMapping         bool
	Options            map[string]interface{}
}

// CreateMigrationJob creates migration jobs for all combinations of source and destination path IDs.
// Returns a slice of jobConfigIDs (even if only one).
func CreateMigrationJob(params MigrationJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createMigrationURL := JOB_SERVICE_URL + "/api/v1/jobs/bulk-migrate"

	// Build migrateConfigs as a slice of maps for all combinations
	var migrateConfigs []map[string]interface{}
	minLen := len(params.SourcePathIDs)
	if len(params.DestinationPathIDs) < minLen {
		minLen = len(params.DestinationPathIDs)
	}
	for i := 0; i < minLen; i++ {
		migrateConfigs = append(migrateConfigs, map[string]interface{}{
			"sourcePathId":      params.SourcePathIDs[i],
			"destinationPathId": []string{params.DestinationPathIDs[i]},
		})
	}

	migrationPayload := map[string]interface{}{
		"firstRunAt":        params.FirstRunAt,
		"futureRunSchedule": params.FutureRunSchedule,
		"migrateConfigs":    migrateConfigs,
		"sid_mapping":       params.SidMapping,
		"options":           params.Options,
	}

	payloadBytes, err := json.Marshal(migrationPayload)
	if err != nil {
		return nil, nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createMigrationURL, payloadBytes, headers)
	if err != nil {
		return nil, nil, err
	}

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, resp, err
	}

	var migrationResp struct {
		Jobs []map[string]interface{} `json:"jobs"`
	}
	err = json.Unmarshal(bodyBytes, &migrationResp)
	if err != nil {
		return nil, resp, err
	}

	var jobConfigIDs []string
	for _, job := range migrationResp.Jobs {
		if id, ok := job["id"].(string); ok && id != "" {
			jobConfigIDs = append(jobConfigIDs, id)
		}
	}

	return jobConfigIDs, resp, nil
}

// CreateBulkCutoverJob creates bulk cutover jobs for all combinations of source and destination path IDs.
func CreateBulkCutoverJob(params BulkCutoverJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createBulkCutoverURL := JOB_SERVICE_URL + "/api/v1/jobs/bulk-cutover"

	// Build cutoverConfig as a slice of maps for all combinations
	var cutoverConfigs []map[string]interface{}
	minLen := len(params.SourcePathIDs)
	if len(params.DestinationPathIDs) < minLen {
		minLen = len(params.DestinationPathIDs)
	}
	for i := 0; i < minLen; i++ {
		cutoverConfigs = append(cutoverConfigs, map[string]interface{}{
			"sourcePathId":      params.SourcePathIDs[i],
			"destinationPathId": []string{params.DestinationPathIDs[i]},
		})
	}

	payload := map[string]interface{}{
		"cutoverConfig": cutoverConfigs,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createBulkCutoverURL, payloadBytes, headers)
	if err != nil {
		return nil, nil, err
	}

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, resp, err
	}

	var bulkCutoverResp []map[string]interface{}
	err = json.Unmarshal(bodyBytes, &bulkCutoverResp)
	if err != nil {
		return nil, resp, err
	}

	var jobConfigIDs []string
	for _, job := range bulkCutoverResp {
		if id, ok := job["id"].(string); ok && id != "" {
			jobConfigIDs = append(jobConfigIDs, id)
		}
	}

	return jobConfigIDs, resp, nil
}

// approveBulkCutoverJob sends an approval (or rejection) action for a bulk cutover job run.
// action should be "APPROVED" or "REJECTED".

func ApproveRejectBulkCutoverJob(jobRunID, action string, headers map[string]string) (*http.Response, error) {
	approveJobURL := JOB_SERVICE_URL + "/api/v1/job-run/cutover/approve"
	approvePayload := map[string]interface{}{
		"action":   action,
		"jobRunId": jobRunID,
	}
	approveBytes, err := json.Marshal(approvePayload)
	if err != nil {
		return nil, err
	}

	resp, err := SendAPIRequest("PUT", approveJobURL, approveBytes, headers)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func GetJobRunIDForSource(jobConfigID string, headers map[string]string) (string, *http.Response, error) {
	getJobSourceURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)

	var lastErr error
	var resp *http.Response

	for attempt := 1; attempt <= GetJobRunIDMaxRetries; attempt++ {
		resp, err := SendAPIRequest(http.MethodGet, getJobSourceURL, nil, headers)
		if err != nil {
			lastErr = err
			time.Sleep(GetJobRunIDRetryInterval * time.Second)
			continue
		}

		bodyBytes, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			lastErr = err
			resp.Body.Close()
			time.Sleep(GetJobRunIDRetryInterval * time.Second)
			continue
		}
		resp.Body.Close()

		var getJobResp GetJobResponse
		err = json.Unmarshal(bodyBytes, &getJobResp)
		if err != nil {
			lastErr = err
			time.Sleep(GetJobRunIDRetryInterval * time.Second)
			continue
		}

		if len(getJobResp.JobRuns) > 0 && getJobResp.JobRuns[0].JobRunId != "" {
			return getJobResp.JobRuns[0].JobRunId, resp, nil
		}

		lastErr = fmt.Errorf("no jobRuns found in response")
		time.Sleep(GetJobRunIDRetryInterval * time.Second)
	}

	return "", resp, fmt.Errorf("failed to get jobRunID after %d retries: %v", GetJobRunIDMaxRetries, lastErr)
}

// getBlockedJobRunID fetches job runs for a given jobConfigID, asserts the first run is BLOCKED,
// and returns the jobRunId.
func GetBlockedJobRunID(jobConfigID string, headers map[string]string) (GetJobResponse, *http.Response, error) {
	getJobsURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)
	resp, err := SendAPIRequest(http.MethodGet, getJobsURL, nil, headers)
	if err != nil {
		return GetJobResponse{}, nil, err
	}

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return GetJobResponse{}, resp, err
	}

	var getJobsResp GetJobResponse
	err = json.Unmarshal(bodyBytes, &getJobsResp)
	if err != nil {
		return GetJobResponse{}, resp, err
	}

	return getJobsResp, resp, nil
}

// WaitForJobState polls the job run status until it matches the desired state or times out.

func WaitForJobState(jobRunID string, desiredJobState string, pollRetries ...int) error {
	url := fmt.Sprintf("%s/api/v1/report/job-run/%s", JOB_SERVICE_URL, jobRunID)
	var retryCount int
	if len(pollRetries) > 0 && pollRetries[0] > 0 {
		retryCount = pollRetries[0]
	} else {
		retryCount = MaxJobPollRetries
	}
	headers := GetHeaders(AuthToken, ContentTypeJSON)

	for i := 0; i < retryCount; i++ {
		apiResp, err := checkJobRunStatus(url, headers)
		LogDebug(fmt.Sprintf("Checking job run status for ID %s, attempt %d", jobRunID, i+1))
		LogDebug(fmt.Sprintf("API response: %+v", apiResp))
		if err != nil {
			return err
		}
		if apiResp.Status == desiredJobState {
			LogDebug("Job reached desired state: " + desiredJobState + ".")
			return nil
		}
		time.Sleep(time.Duration(DefaultJobPollInterval) * time.Second)
	}
	time.Sleep(time.Duration(DefaultJobPollInterval) * time.Second)
	return fmt.Errorf("job %s did not reach state %s after %d retries", jobRunID, desiredJobState, MaxJobPollRetries)
}

// ChangeJobRunState changes the state of a job run (PAUSE, RESUME, STOP).
// It polls for the appropriate state before making the change, with a timeout for PAUSE.
func ChangeJobRunState(jobRunID, stateType string, intervalSeconds int, jobRunIDs []string) error {
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	const timeoutDuration = 3 * time.Minute
	jobStatusURL := fmt.Sprintf("%s/api/v1/report/job-run/%s", JOB_SERVICE_URL, jobRunID)

	switch stateType {
	case RESUME_JOBRUN, STOP_JOBRUN:
		apiResp, err := checkJobRunStatus(jobStatusURL, headers)
		if err != nil {
			return err
		}
		if stateType == RESUME_JOBRUN && apiResp.Status == PAUSE_JOBRUN {
			LogDebug("Job is paused. Resuming operation.")
			return ChangeJobRunStateAPI(stateType, jobRunIDs)
		}
		LogDebug("No paused job run found or not RESUME. Sending state change.")
		return ChangeJobRunStateAPI(stateType, jobRunIDs)

	case PAUSE_JOBRUN:
		startTime := time.Now()
		for {
			apiResp, err := checkJobRunStatus(jobStatusURL, headers)
			fmt.Printf("[DEBUG] Pause polling response: %+v, error: %v\n", apiResp, err)
			if err != nil {
				return err
			}
			LogDebug(fmt.Sprintf("Status check response: %+v", apiResp))
			if apiResp.Status == RUNNING_JOBRUN {
				LogDebug("Job is running. Pausing operation.")
				return ChangeJobRunStateAPI(stateType, jobRunIDs)
			}
			LogError(fmt.Sprintf("JobRun is not in running state. Current state: %s", apiResp.Status))
			if time.Since(startTime) > timeoutDuration {
				LogDebug("Timeout reached. Exiting the polling loop after 3 minutes.")
				break
			}
			time.Sleep(time.Duration(intervalSeconds) * time.Second)
		}
	default:
		return fmt.Errorf("unsupported job run state: %s", stateType)
	}
	return fmt.Errorf("job run state check timed out after 3 minutes")
}

// checkJobRunStatus fetches the job run status from the API.
func checkJobRunStatus(url string, headers map[string]string) (JobStatus, error) {
	resp, err := SendAPIRequest(http.MethodGet, url, nil, headers)
	fmt.Println("[DEBUG] check api url:", url)
	fmt.Println("[DEBUG] check response api response:", resp)
	if err != nil {
		return JobStatus{}, fmt.Errorf("error calling API: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return JobStatus{}, fmt.Errorf("error reading response body: %v", err)
	}
	var apiResp JobStatus
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return JobStatus{}, fmt.Errorf("error parsing JSON: %v", err)
	}
	LogDebug(fmt.Sprintf("Status check response: %+v", apiResp))
	return apiResp, nil
}

// ChangeJobRunStateAPI sends the actual state change request to the API.
func ChangeJobRunStateAPI(action string, jobRunIDs []string) error {
	apiURL := fmt.Sprintf("%s/api/v1/job-run/action", JOB_SERVICE_URL)
	payload := map[string]interface{}{
		"action":  action,
		"jobRuns": jobRunIDs,
	}
	fmt.Println("[DEBUG] payload for change jobrun status 1:", payload)
	payloadBytes, err := json.Marshal(payload)
	fmt.Println("[DEBUG] payload for change jobrun status 2:", payloadBytes)
	if err != nil {
		return fmt.Errorf("error marshaling JSON: %v", err)
	}
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	resp, err := SendAPIRequest(http.MethodPut, apiURL, payloadBytes, headers)
	if err != nil {
		return fmt.Errorf("error calling API: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("error reading response body: %v", err)
	}
	LogDebug(fmt.Sprintf("ChangeJobRunStateAPI response body: %s", body))
	return nil
}
