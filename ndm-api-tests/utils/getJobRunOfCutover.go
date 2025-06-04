package utils

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

// getBlockedJobRunID fetches job runs for a given jobConfigID, asserts the first run is BLOCKED,
// and returns the jobRunId.
func GetBlockedJobRunID(jobConfigID string, headers map[string]string) string {

	getJobsURL := JOB_SERVICE_URL + "/api/v1/jobs/" + jobConfigID
	resp, err := SendAPIRequest("GET", getJobsURL, nil, headers)
	Expect(err).NotTo(HaveOccurred(), "Error sending get jobs request")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusOK)

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading get jobs response")
	var getJobsResp map[string]interface{}
	err = json.Unmarshal(bodyBytes, &getJobsResp)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling get jobs response")

	jobRuns, exists := getJobsResp["jobRuns"].([]interface{})
	Expect(exists).To(BeTrue(), "jobRuns not found in response")
	Expect(len(jobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
	firstJobRun, ok := jobRuns[0].(map[string]interface{})
	Expect(ok).To(BeTrue(), "jobRuns[0] not a valid object")
	status, ok := firstJobRun["status"].(string)
	Expect(ok).To(BeTrue(), "jobRuns[0].status is not a string")
	Expect(status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")
	cutoverID, ok := firstJobRun["jobRunId"].(string)
	Expect(ok).To(BeTrue(), "id_cutover not found or not a string")

	return cutoverID
}
