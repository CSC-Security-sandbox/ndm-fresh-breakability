package utils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

type GetJobResponse struct {
	JobRuns []struct {
		JobRunId string `json:"jobRunId"`
	} `json:"jobRuns"`
}

type JobResponse []struct {
	ID string `json:"id"`
}

func checkResponse(resp *http.Response, expected int) {
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

func CreateDiscoveryJob(params DiscoveryJobParams, headers map[string]string) []string {
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
	LogError("Error marshaling discovery job payload for destination", err)
	Expect(err).NotTo(HaveOccurred(), "Error marshaling discovery job payload for destination")

	resp, err := SendAPIRequest("POST", createDiscoveryURL, payloadBytes, headers)
	LogError("Error sending discovery job API request for destination", err)
	Expect(err).NotTo(HaveOccurred(), "Error sending discovery job API request for destination")
	defer resp.Body.Close()

	checkResponse(resp, http.StatusCreated)

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading discovery job response body for destination")

	var jobDestResp JobResponse
	err = json.Unmarshal(bodyBytes, &jobDestResp)
	LogError("Error unmarshaling job response for destination", err)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling job response for destination")
	Expect(len(jobDestResp)).To(BeNumerically(">", 0), "No job entry found in destination discovery job response")

	// Collect all job config IDs
	var jobConfigIDs []string
	for _, job := range jobDestResp {
		if job.ID != "" {
			jobConfigIDs = append(jobConfigIDs, job.ID)
		}
	}
	Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")

	return jobConfigIDs
}
