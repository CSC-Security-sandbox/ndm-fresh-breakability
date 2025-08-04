package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type GetJobResponse struct {
	JobConfigId       string          `json:"jobConfigId"`
	JobType           string          `json:"jobType"`
	SourceServer      ServerInfo      `json:"sourceServer"`
	DestinationServer ServerInfo      `json:"destinationServer"`
	Status            string          `json:"status"`
	NextScheduleDate  string          `json:"nextScheduleDate"`
	CreatedAt         string          `json:"createdAt"`
	JobRuns           []JobRun        `json:"jobRuns"`
	AggregateData     AggregateData   `json:"aggregateData"`
	Errors            json.RawMessage `json:"errors"`
}

type ServerInfo struct {
	ServerName string `json:"serverName"`
	Path       string `json:"path"`
	Protocol   string `json:"protocol"`
}

type JobRun struct {
	JobRunId string `json:"jobRunId"`
	Status   string `json:"status"`
}

type AggregateData struct {
	TimeElapsed             int    `json:"timeElapsed"`
	ScannedFilesCount       string `json:"scannedFilesCount"`
	ScannedDirectoriesCount string `json:"scannedDirectoriesCount"`
	TotalScannedSize        string `json:"totalScannedSize"`
}

type JobResponse []struct {
	ID string `json:"id"`
}

type BulkCutoverJobParams struct {
	SourcePathIDs      []string
	DestinationPathIDs []string
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

type AdHocJobRunRequest struct {
	JobConfigId string `json:"jobConfigId"`
}

// Struct for response (top-level id is jobRunId)
type AdHocJobRunResponse struct {
	ID string `json:"id"`
}

// CreateDiscoveryJob creates a discovery job using the provided parameters and headers,
// parses the response, and returns the destination job configuration ID.
func CreateDiscoveryJob(params DiscoveryJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createDiscoveryURL := JOB_SERVICE_URL + CREATE_DISCOVERY_ENDPOINT

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

	bodyBytes, err := io.ReadAll(resp.Body)
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
	ExtraParams        map[string]interface{}
}

// CreateMigrationJob creates migration jobs for all combinations of source and destination path IDs.
// Returns a slice of jobConfigIDs (even if only one).
func CreateMigrationJob(params MigrationJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createMigrationURL := JOB_SERVICE_URL + CREATE_MIGRATION_ENDPOINT

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

	// This extra params is used when any new key-value needs to add in struct e.g., gidMapping
	if params.ExtraParams != nil {
		for key, value := range params.ExtraParams {
			migrationPayload[key] = value
		}
	}
	payloadBytes, err := json.Marshal(migrationPayload)
	if err != nil {
		return nil, nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createMigrationURL, payloadBytes, headers)
	if err != nil {
		return nil, nil, err
	}

	bodyBytes, err := io.ReadAll(resp.Body)
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
	createBulkCutoverURL := JOB_SERVICE_URL + CREATE_CUTOVER_ENDPOINT

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

	bodyBytes, err := io.ReadAll(resp.Body)
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

// ApproveRejectBulkCutoverJob sends an approval (or rejection) action for a bulk cutover job run.
// action should be "APPROVED" or "REJECTED".
func ApproveRejectBulkCutoverJob(jobRunID, action string, headers map[string]string) (*http.Response, error) {
	approveJobURL := JOB_SERVICE_URL + CUTOVER_APPROVE_REJECT_ENDPOINT
	approvePayload := map[string]interface{}{
		"action":   action,
		"jobRunId": jobRunID,
	}
	approveBytes, err := json.Marshal(approvePayload)
	if err != nil {
		return nil, err
	}

	resp, err := SendAPIRequest(http.MethodPut, approveJobURL, approveBytes, headers)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// GetJobRunDetails fetches GetJobResponse struct and job runs, status from same for a given jobConfigID, this function can be used to validated
// other details from response by modifying the GetJobResponse struct
func GetJobRunDetails(jobConfigID string, headers map[string]string, needRetryAttempt ...bool) (GetJobResponse, *http.Response, error) {
	jobsURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)
	var resp *http.Response

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		resp, err := SendAPIRequest(http.MethodGet, jobsURL, nil, headers)
		if err != nil {
			return GetJobResponse{}, resp, fmt.Errorf("error while sending api request , err : %v", err)
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return GetJobResponse{}, resp, fmt.Errorf("error reading response body: %w", err)
		}

		var getJobsResp GetJobResponse
		err = json.Unmarshal(bodyBytes, &getJobsResp)
		if err != nil {
			return GetJobResponse{}, resp, fmt.Errorf("error unmrashling response: %w", err)
		}

		LogDebug(fmt.Sprintf("Getting job run details for ID %s, jobType %s, attempt %d", jobConfigID, getJobsResp.JobType, attempt))
		if len(needRetryAttempt) > 0 {
			return getJobsResp, resp, nil
		}

		if len(getJobsResp.JobRuns) > 0 {
			return getJobsResp, resp, nil
		}

		Wait(DefaultPollInterval)
	}

	return GetJobResponse{}, resp, fmt.Errorf("failed to get job run details after %d ", MaxPollRetries)
}

// WaitForJobState polls the job run status until it matches the desired state or times out.
func WaitForJobState(jobRunID string, desiredJobState string, pollRetries ...int) error {
	// Determine the number of retries to use
	retryCount := MaxPollRetries
	if len(pollRetries) > 0 && pollRetries[0] > 0 {
		retryCount = pollRetries[0]
	}

	for i := 0; i < retryCount; i++ {
		status, err := checkJobRunStatus(jobRunID)
		if err != nil {
			return err
		}

		LogDebug(fmt.Sprintf("Current job run status for ID %s = %s, attempt %d", jobRunID, status, i+1))

		if status == ERRORED_JOBRUN {
			return fmt.Errorf("job %s entered ERRORED state", jobRunID)
		}

		if status == desiredJobState {
			LogDebug("Job reached desired state: " + desiredJobState + ".")
			return nil
		}

		if status == COMPLETED_JOBRUN || status == BLOCKED_JOBRUN {
			LogDebug("Job reached desired state: " + status + ".")
			return nil
		}
		Wait(DefaultPollInterval)

	}

	return fmt.Errorf("job %s did not reach state %s after %d retries", jobRunID, desiredJobState, retryCount)
}

// HandleJobRunStateChange changes the state of a job run (PAUSE, RESUME, STOP).
func HandleJobRunStateChange(jobRunID, stateType string, jobRunIDs []string) error {

	switch stateType {
	case RESUME_JOBRUN, STOP_JOBRUN:
		status, err := checkJobRunStatus(jobRunID)
		if err != nil {
			return err
		}
		if stateType == RESUME_JOBRUN && status == PAUSE_JOBRUN {
			LogDebug("Job is paused. Resuming operation.")
			return ChangeJobRunState(stateType, jobRunIDs)
		}
		LogDebug("No paused job run found or not RESUME. Sending state change")
		return ChangeJobRunState(stateType, jobRunIDs)

	case PAUSE_JOBRUN:
		for i := 0; i < MaxPollRetries; i++ {
			status, err := checkJobRunStatus(jobRunID)
			if err != nil {
				return err
			}
			if status == RUNNING_JOBRUN {
				LogDebug("Job is running. Pausing JobRun.")
				return ChangeJobRunState(stateType, jobRunIDs)
			}
			LogDebug(fmt.Sprintf("JobRun is not in running state. Current state: %s", status))
			Wait(DefaultPollInterval)
		}
		return fmt.Errorf("Job run did not reach RUNNING state after %d retries", MaxPollRetries)
	default:
		return fmt.Errorf("unsupported job run state: %s", stateType)
	}
}

// checkJobRunStatus fetches the job run status from the API.
func checkJobRunStatus(jobRunID string) (string, error) {
	url := fmt.Sprintf("%s%s/%s", JOB_SERVICE_URL, JOB_RUN_ENDPOINT, jobRunID)
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	resp, err := SendAPIRequest(http.MethodGet, url, nil, headers)
	if err != nil {
		return "", fmt.Errorf("error calling API: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading response body: %v", err)
	}
	var temp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &temp); err != nil {
		return "", fmt.Errorf("error parsing JSON: %v", err)
	}
	return temp.Status, nil
}

// ChangeJobRunState sends the actual state change request to the API.
func ChangeJobRunState(action string, jobRunIDs []string) error {

	apiURL := fmt.Sprintf("%s%s", JOB_SERVICE_URL, JOB_RUN_ACTION_ENDPOINT)
	payload := map[string]interface{}{
		"action":  action,
		"jobRuns": jobRunIDs,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error marshaling JSON: %v", err)
	}
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	resp, err := SendAPIRequest(http.MethodPut, apiURL, payloadBytes, headers)
	if err != nil {
		return fmt.Errorf("error calling API: %v", err)
	}
	defer resp.Body.Close()
	_, err = io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("error reading response body: %v", err)
	}
	LogDebug(fmt.Sprintf("State of Job Run IDs [%s] is changed to %s", strings.Join(jobRunIDs, ","), action))
	return nil
}

func TriggerAdHocJobRun(jobConfigId string) (string, *http.Response, error) {
	url := fmt.Sprintf("%s%s", CONFIG_SERVICE_URL, ADHOC_JOBRUN_URL)
	// Prepare request body
	reqBody := AdHocJobRunRequest{JobConfigId: jobConfigId}
	payloadBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, err
	}
	// Prepare headers
	headers := GetHeaders(AuthToken, ContentTypeJSON)

	// Send request using your utility
	resp, err := SendAPIRequest(http.MethodPost, url, payloadBytes, headers)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	LogDebug(fmt.Sprintf("adhoc run response : %+v", resp))
	// Read response
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp, err
	}

	// Parse response
	var jobRunResp AdHocJobRunResponse
	err = json.Unmarshal(bodyBytes, &jobRunResp)
	if err != nil {
		return "", resp, err
	}

	if jobRunResp.ID == "" {
		return "", resp, fmt.Errorf("JobRunId not found in response")
	}

	return jobRunResp.ID, resp, nil
}

// This function gets the summary of Job config which includes NextScheduled Time
// GetJobSummaryByConfigID is different than GetJobRunDetails because the later only gives state
// of current job runs using configID and not of NextScheduled Time which are already present whereas
// prior gives NextScheduled Time details, both functions end points are also different
func GetJobSummaryByConfigID(
	projectID,
	desiredConfigID string,
	headers map[string]string,
) (*GetJobResponse, error) {
	// build URL
	url := fmt.Sprintf("%s/api/v1/jobs?projectId=%s", JOB_SERVICE_URL, projectID)

	// send request
	resp, err := SendAPIRequest(http.MethodGet, url, nil, headers)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	// read & unmarshal
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var allJobs []GetJobResponse
	if err := json.Unmarshal(buf, &allJobs); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	// find the one matching desiredConfigID
	for i := range allJobs {
		if allJobs[i].JobConfigId == desiredConfigID {
			return &allJobs[i], nil
		}
	}

	return nil, fmt.Errorf("jobConfigId %q not found", desiredConfigID)
}
