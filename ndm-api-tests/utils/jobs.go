package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// =============================================================================
// JOB DATA STRUCTURES
// =============================================================================

// Unified job item that works for all job types
type JobItem struct {
	ID     string `json:"id"`
	Status string `json:"status,omitempty"`
}

// For migration responses that have nested jobs array
type MigrationResponseItems struct {
	Jobs []JobItem `json:"jobs"`
}

// Detailed job response structure
type GetJobResponse struct {
	JobConfigId             string                 `json:"jobConfigId"`
	JobType                 string                 `json:"jobType"`
	SourceServer            ServerInfo             `json:"sourceServer"`
	DestinationServer       ServerInfo             `json:"destinationServer"`
	Status                  string                 `json:"status"`
	NextScheduleDate        string                 `json:"nextScheduleDate"`
	CreatedAt               string                 `json:"createdAt"`
	JobRuns                 []JobRun               `json:"jobRuns"`
	AggregateData           AggregateData          `json:"aggregateData"`
	ConfigurationsSetToJob  map[string]interface{} `json:"configurationsSetToJob"`
	Errors                  json.RawMessage        `json:"errors"`
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

// =============================================================================
// TYPE ALIASES FOR DIFFERENT RESPONSE PATTERNS
// =============================================================================

type JobResponse = ApiResponse[JobItem]
type MigrationResponse = ApiResponse[MigrationResponseItems]

// =============================================================================
// PARAMETER STRUCTURES
// =============================================================================

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
	Extra                    map[string]interface{}
}

type MigrationJobParams struct {
	FirstRunAt               string
	FutureRunSchedule        string
	SourcePathIDs            []string
	DestinationPathIDs       []string
	SidMapping               interface{}
	Options                  map[string]interface{}
	ExtraParams              map[string]interface{}
	// Optional: when set, migration is scoped to this subdirectory on the source volume.
	SourceDirectoryPath string
	// Optional: when set, files land under this subdirectory on the destination volume.
	// Pass an empty string (or omit) to migrate to the root of the destination volume.
	DestinationDirectoryPath     string
	SmbPermissionInheritanceMode string
}

// SmbPermissionInheritanceConfigLabel is the jobs API configuration display key.
const SmbPermissionInheritanceConfigLabel = "Convert inherited permissions into explicit"

const (
	SmbInheritModeAsIs       = "INHERIT_PERMS_AS_IS"
	SmbInheritModeAsExplicit = "INHERIT_PERMS_AS_EXPLICIT"
)

type BulkCutoverJobParams struct {
	SourcePathIDs             []string
	DestinationPathIDs        []string
	SourceDirectoryPath      string
	DestinationDirectoryPath string
}

type AdHocJobRunRequest struct {
	JobConfigId string `json:"jobConfigId"`
}

type AdHocJobRunResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}

// GetDirsRequest is the payload for POST /api/v1/jobs/get-dirs.
type GetDirsRequest struct {
	FileServerID string `json:"fileServerId"`
	ExportPath   string `json:"exportPath"`
	Path         string `json:"path,omitempty"`
	Dir          string `json:"dir,omitempty"`
}

// GetDirsEntry represents a single directory entry returned by get-dirs.
type GetDirsEntry struct {
	Name string `json:"name"`
}

// getDirsResponse is the envelope returned by POST /api/v1/jobs/get-dirs.
type getDirsResponse struct {
	Data struct {
		Items []GetDirsEntry `json:"items"`
	} `json:"data"`
}

// =============================================================================
// DIRECTORY LISTING
// =============================================================================

// GetDirs calls POST /api/v1/jobs/get-dirs and returns the list of subdirectory
// names under the given export path (optionally scoped to a sub-path).
func GetDirs(req GetDirsRequest, headers map[string]string) ([]GetDirsEntry, *http.Response, error) {
	getDirsURL := JOB_SERVICE_URL + GET_DIRS_ENDPOINT

	payloadBytes, err := json.Marshal(req)
	if err != nil {
		return nil, nil, fmt.Errorf("GetDirs: failed to marshal request: %v", err)
	}

	resp, err := SendAPIRequest(http.MethodPost, getDirsURL, payloadBytes, headers)
	if err != nil {
		return nil, nil, fmt.Errorf("GetDirs: API request error: %v", err)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp, fmt.Errorf("GetDirs: failed to read response body: %v", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, resp, fmt.Errorf("GetDirs: unexpected HTTP status %d — body: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	var envelope getDirsResponse
	if err := json.Unmarshal(bodyBytes, &envelope); err != nil {
		return nil, resp, fmt.Errorf("GetDirs: failed to unmarshal response: %v", err)
	}

	dirs := envelope.Data.Items
	LogDebug(fmt.Sprintf("GetDirs: found %d directories under exportPath=%s path=%s", len(dirs), req.ExportPath, req.Path))
	return dirs, resp, nil
}

// =============================================================================
// JOB CREATION FUNCTIONS
// =============================================================================

const snapshotExcludeFilePatterns = ", */~snapshot/*, */.snapshot/*"

// CreateDiscoveryJob creates a discovery job using the provided parameters and headers,
// parses the response, and returns the destination job configuration ID.
func CreateDiscoveryJob(params DiscoveryJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createDiscoveryURL := JOB_SERVICE_URL + CREATE_DISCOVERY_ENDPOINT

	params.ExcludeFilePatterns += snapshotExcludeFilePatterns

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
		err = fmt.Errorf("discovery job creation failed: API request error: %v", err)
		return nil, nil, err
	}

	// Validate HTTP response status
	if resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("discovery job creation failed: expected HTTP 200 OK, got %d", resp.StatusCode)
		return nil, resp, err
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		err = fmt.Errorf("discovery job creation failed: error reading response body: %v", err)
		return nil, resp, err
	}

	var jobDestResp JobResponse
	err = json.Unmarshal(bodyBytes, &jobDestResp)
	if err != nil {
		err = fmt.Errorf("discovery job creation failed: error unmarshaling response: %v", err)
		return nil, resp, err
	}

	// Collect all job config IDs
	var jobConfigIDs []string
	for _, job := range jobDestResp.Data.Items {
		if job.ID != "" {
			jobConfigIDs = append(jobConfigIDs, job.ID)
		}
	}

	// Validate job count and non-empty results
	if len(jobConfigIDs) == 0 {
		err = fmt.Errorf("discovery job creation failed: no valid jobConfigIDs found in response")
		return nil, resp, err
	}

	return jobConfigIDs, resp, nil
}

func buildMigrationJobPayload(params MigrationJobParams) ([]byte, error) {
	if params.Options == nil {
		params.Options = map[string]interface{}{}
	}

	// Skip .snapshot file for all migrations
	excludeFilePatterns, ok := params.Options["excludeFilePatterns"].(string)
	if !ok {
		return nil, nil, errors.New("excludeFilePatterns must be a string")
	}
	excludeFilePatterns += snapshotExcludeFilePatterns
	params.Options["excludeFilePatterns"] = excludeFilePatterns

	if params.SmbPermissionInheritanceMode != "" {
		params.Options["smbPermissionInheritanceMode"] = params.SmbPermissionInheritanceMode
	}

	var migrateConfigs []map[string]interface{}
	minLen := len(params.SourcePathIDs)
	if len(params.DestinationPathIDs) < minLen {
		minLen = len(params.DestinationPathIDs)
	}
	for i := 0; i < minLen; i++ {
		cfg := map[string]interface{}{
			"sourcePathId":      params.SourcePathIDs[i],
			"destinationPathId": []string{params.DestinationPathIDs[i]},
		}
		if params.SourceDirectoryPath != "" {
			cfg["sourceDirectoryPath"] = params.SourceDirectoryPath
		}
		if params.DestinationDirectoryPath != "" {
			cfg["destinationDirectoryPath"] = params.DestinationDirectoryPath
		}
		migrateConfigs = append(migrateConfigs, cfg)
	}

	migrationPayload := map[string]interface{}{
		"firstRunAt":        params.FirstRunAt,
		"futureRunSchedule": params.FutureRunSchedule,
		"migrateConfigs":    migrateConfigs,
		"sidMapping":        params.SidMapping,
		"options":           params.Options,
	}

	if params.ExtraParams != nil {
		for key, value := range params.ExtraParams {
			migrationPayload[key] = value
		}
	}

	return json.Marshal(migrationPayload)
}

func parseMigrationJobResponse(resp *http.Response) ([]string, *http.Response, error) {
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		err = fmt.Errorf("migration job creation failed: error reading response body: %v", err)
		return nil, resp, err
	}

	var migrationResp MigrationResponse
	err = json.Unmarshal(bodyBytes, &migrationResp)
	if err != nil {
		err = fmt.Errorf("migration job creation failed: error unmarshaling response: %v", err)
		return nil, resp, err
	}

	var jobConfigIDs []string
	if len(migrationResp.Data.Items) > 0 {
		for _, job := range migrationResp.Data.Items[0].Jobs {
			if job.ID != "" {
				jobConfigIDs = append(jobConfigIDs, job.ID)
			}
		}
	}

	if len(jobConfigIDs) == 0 {
		err = fmt.Errorf("migration job creation failed: no valid jobConfigIDs found in response")
		return nil, resp, err
	}

	LogDebug(fmt.Sprintf("Migration job creation completed successfully. Created %d jobs with IDs: %v", len(jobConfigIDs), jobConfigIDs))
	return jobConfigIDs, resp, nil
}

// CreateMigrationJob creates migration jobs for all combinations of source and destination path IDs.
// Returns a slice of jobConfigIDs (even if only one).
func CreateMigrationJob(params MigrationJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createMigrationURL := JOB_SERVICE_URL + CREATE_MIGRATION_ENDPOINT

	payloadBytes, err := buildMigrationJobPayload(params)
	if err != nil {
		return nil, nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createMigrationURL, payloadBytes, headers)
	if err != nil {
		err = fmt.Errorf("migration job creation failed: API request error: %v", err)
		return nil, nil, err
	}

	if resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("migration job creation failed: expected HTTP 200 OK, got %d", resp.StatusCode)
		return nil, resp, err
	}

	return parseMigrationJobResponse(resp)
}

// CreateMigrationJobRaw posts a migration job and returns the HTTP response without treating non-2xx as an error.
func CreateMigrationJobRaw(params MigrationJobParams, headers map[string]string) ([]string, *http.Response, error) {
	createMigrationURL := JOB_SERVICE_URL + CREATE_MIGRATION_ENDPOINT

	payloadBytes, err := buildMigrationJobPayload(params)
	if err != nil {
		return nil, nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createMigrationURL, payloadBytes, headers)
	if err != nil {
		return nil, nil, fmt.Errorf("migration job creation failed: API request error: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, resp, nil
	}

	return parseMigrationJobResponse(resp)
}

// GetSmbInheritanceModeFromJobConfig reads the stored SMB inheritance toggle label from job details.
func GetSmbInheritanceModeFromJobConfig(jobConfigID string, headers map[string]string) (string, bool, error) {
	jobDetails, _, err := GetJobRunDetails(jobConfigID, headers, true)
	if err != nil {
		return "", false, err
	}
	if jobDetails.ConfigurationsSetToJob == nil {
		return "", false, nil
	}
	raw, ok := jobDetails.ConfigurationsSetToJob[SmbPermissionInheritanceConfigLabel]
	if !ok || raw == nil {
		return "", false, nil
	}
	label, ok := raw.(string)
	if !ok {
		return "", false, fmt.Errorf("unexpected type for %s: %T", SmbPermissionInheritanceConfigLabel, raw)
	}
	return label, true, nil
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
		var srcDirPath interface{} = nil
		if params.SourceDirectoryPath != "" {
			srcDirPath = params.SourceDirectoryPath
		}
		var destDirPath interface{} = nil
		if params.DestinationDirectoryPath != "" {
			destDirPath = params.DestinationDirectoryPath
		}
		cutoverConfigs = append(cutoverConfigs, map[string]interface{}{
			"sourcePathId":             params.SourcePathIDs[i],
			"destinationPathId":        []string{params.DestinationPathIDs[i]},
			"sourceDirectoryPath":      srcDirPath,
			"destinationDirectoryPath": destDirPath,
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
		err = fmt.Errorf("cutover job creation failed: API request error: %v", err)
		return nil, nil, err
	}

	// Validate HTTP response status (bulk-cutover endpoint returns 201 Created)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("cutover job creation failed: expected HTTP 201 Created, got %d", resp.StatusCode)
		return nil, resp, err
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		err = fmt.Errorf("cutover job creation failed: error reading response body: %v", err)
		return nil, resp, err
	}

	var bulkCutoverResp JobResponse
	err = json.Unmarshal(bodyBytes, &bulkCutoverResp)
	if err != nil {
		err = fmt.Errorf("cutover job creation failed: error unmarshaling response: %v", err)
		return nil, resp, err
	}

	var jobConfigIDs []string
	for i, job := range bulkCutoverResp.Data.Items {
		LogDebug(fmt.Sprintf("Cutover job %d: ID='%s'", i, job.ID))
		if job.ID != "" {
			jobConfigIDs = append(jobConfigIDs, job.ID)
		}
	}

	// Validate job count and non-empty results
	if len(jobConfigIDs) == 0 {
		err = fmt.Errorf("cutover job creation failed: no valid jobConfigIDs found in response")
		return nil, resp, err
	}

	return jobConfigIDs, resp, nil
}

// TriggerAdHocJobRun triggers an ad-hoc job run for the given jobConfigId.
func TriggerAdHocJobRun(jobConfigId string) (string, *http.Response, error) {
	url := fmt.Sprintf("%s%s", CONFIG_SERVICE_URL, ADHOC_JOBRUN_URL)

	// Prepare request body
	reqBody := AdHocJobRunRequest{JobConfigId: jobConfigId}
	payloadBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("adhoc job run failed: error marshaling request: %v", err)
	}

	// Prepare headers
	headers := GetHeaders(AuthToken, ContentTypeJSON)

	// Send request using your utility
	resp, err := SendAPIRequest(http.MethodPost, url, payloadBytes, headers)
	if err != nil {
		return "", nil, fmt.Errorf("adhoc job run failed: API request error: %v", err)
	}

	// Validate HTTP response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", resp, fmt.Errorf("adhoc job run failed: expected HTTP 200 OK or 201 Created, got %d", resp.StatusCode)
	}

	LogDebug(fmt.Sprintf("adhoc run response status: %v", resp.StatusCode))

	// Read response
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp, fmt.Errorf("adhoc job run failed: error reading response body: %v", err)
	}

	// Print the raw API response for debugging
	LogDebug(fmt.Sprintf("adhoc job run raw API response: %s", string(bodyBytes)))

	// Parse response
	var jobRunResp AdHocJobRunResponse
	err = json.Unmarshal(bodyBytes, &jobRunResp)
	if err != nil {
		return "", resp, fmt.Errorf("adhoc job run failed: error unmarshaling response: %v", err)
	}

	// Print the parsed response structure for debugging
	LogDebug(fmt.Sprintf("adhoc job run parsed response: %+v", jobRunResp))

	if jobRunResp.Data.ID == "" {
		return "", resp, fmt.Errorf("adhoc job run failed: job run ID not found in response")
	}

	return jobRunResp.Data.ID, resp, nil
}

// =============================================================================
// JOB MANAGEMENT FUNCTIONS
// =============================================================================

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

// =============================================================================
// JOB MONITORING FUNCTIONS
// =============================================================================

// GetJobRunDetails fetches GetJobResponse struct and job runs, status from same for a given jobConfigID, this function can be used to validated
// other details from response by modifying the GetJobResponse struct
func GetJobRunDetails(jobConfigID string, headers map[string]string, needRetryAttempt ...bool) (GetJobResponse, *http.Response, error) {
	jobsURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)
	var resp *http.Response

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		resp, err := SendAPIRequest(http.MethodGet, jobsURL, nil, headers)
		if err != nil {
			return GetJobResponse{}, resp, fmt.Errorf("error while sending api request, err: %v", err)
		}

		// Check if response status is not 200 OK
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return GetJobResponse{}, resp, fmt.Errorf("API request failed with status code %d", resp.StatusCode)
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return GetJobResponse{}, resp, fmt.Errorf("error reading response body: %w", err)
		}

		apiResp, err := UnmarshalApiResponse[GetJobResponse](bodyBytes)
		if err != nil {
			return GetJobResponse{}, resp, fmt.Errorf("error unmarshaling response: %w", err)
		}

		if len(apiResp.Data.Items) > 0 {
			getJobsResp := apiResp.Data.Items[0]

			LogDebug(fmt.Sprintf("Getting job run details for ID %s, jobType %s, attempt %d", jobConfigID, getJobsResp.JobType, attempt))
			if len(needRetryAttempt) > 0 {
				return getJobsResp, resp, nil
			}

			if len(getJobsResp.JobRuns) > 0 {
				return getJobsResp, resp, nil
			}
		}

		Wait(DefaultPollInterval)
	}

	return GetJobResponse{}, resp, fmt.Errorf("failed to get job run details after %d attempts", MaxPollRetries)
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

		if status == FAILED_JOBRUN {
			return fmt.Errorf("job %s entered FAILED state", jobRunID)
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

// GetJobSummaryByConfigID gets the summary of Job config which includes NextScheduled Time
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

	// read & unmarshal using the flexible wrapper
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	// Use the flexible wrapper since all responses are now data.items
	allJobsResp, err := UnmarshalApiResponse[GetJobResponse](buf)
	if err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	// find the one matching desiredConfigID
	for i := range allJobsResp.Data.Items {
		if allJobsResp.Data.Items[i].JobConfigId == desiredConfigID {
			return &allJobsResp.Data.Items[i], nil
		}
	}

	return nil, fmt.Errorf("jobConfigId %q not found", desiredConfigID)
}

// =============================================================================
// JOB STATE MANAGEMENT FUNCTIONS
// =============================================================================

// HandleJobRunStateChange changes the state of a job run (PAUSE, RESUME, STOP).
func HandleJobRunStateChange(jobRunID, stateType string, jobRunIDs []string) error {

	switch stateType {
	case RESUME_JOBRUN, STOP_JOBRUN:
		status, err := checkJobRunStatus(jobRunID)
		if err != nil {
			return err
		}
		if status == COMPLETED_JOBRUN {
			LogDebug("Job is Completed")
			return nil
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
			if status == COMPLETED_JOBRUN {
				LogDebug("Job is Completed")
				return nil
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

	// Use the flexible wrapper since all responses are now data.items
	statusResp, err := UnmarshalApiResponse[JobItem](body)
	if err != nil {
		return "", fmt.Errorf("error parsing JSON: %v", err)
	}

	if len(statusResp.Data.Items) == 0 {
		return "", fmt.Errorf("no status found in response")
	}

	status := statusResp.Data.Items[0].Status
	LogDebug(fmt.Sprintf("Status check response: %s", status))
	return status, nil
}

// GetJobRunInfo returns the details of the job-run API
func GetJobRunInfo(jobRunID string) (GetJobRunResponseItems, error) {
	url := fmt.Sprintf("%s%s/%s", JOB_SERVICE_URL, JOB_RUN_ENDPOINT, jobRunID)
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	resp, err := SendAPIRequest(http.MethodGet, url, nil, headers)
	if err != nil {
		return GetJobRunResponseItems{}, fmt.Errorf("error calling API: %v", err)
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return GetJobRunResponseItems{}, fmt.Errorf("error reading response body: %v", err)
	}

	var response GetJobRunResponse
	// Use the flexible wrapper since all responses are now data.items
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return GetJobRunResponseItems{}, fmt.Errorf("error parsing JSON: %v", err)
	}

	return response.Data.Items, nil
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

// Helper function to delete a job
func DeleteJob(jobID string, headers map[string]string) (*http.Response, error) {
	url := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobID)
	return SendAPIRequest("DELETE", url, nil, headers)
}
