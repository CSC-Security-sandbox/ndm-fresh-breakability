package utils

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
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

	resp, err := SendAPIRequest("PUT", approveJobURL, approveBytes, headers)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// GetJobRunDetails fetches GetJobResponse struct and job runs, status from same for a given jobConfigID, this function can be used to validated
// other details from response by modifying the GetJobResponse struct
func GetJobRunDetails(jobConfigID string, headers map[string]string) (GetJobResponse, *http.Response, error) {
	jobsURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)
	resp, err := SendAPIRequest(http.MethodGet, jobsURL, nil, headers)
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

	// Defensive: check if there is at least one job run
	if len(getJobsResp.JobRuns) == 0 {
		return GetJobResponse{}, resp, err
	}

	return getJobsResp, resp, nil
}
