package utils

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

func GetJobRunIDForSource(jobConfigID string, headers map[string]string) string {
	getJobSourceURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)

	resp, err := SendAPIRequest("GET", getJobSourceURL, nil, headers)
	LogError("Error sending get-job-by-configId API request for source", err)
	Expect(err).NotTo(HaveOccurred(), "Error sending get-job-by-configId API request for source")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusOK)

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading get-job response body for source")

	var getJobResp GetJobResponse
	err = json.Unmarshal(bodyBytes, &getJobResp)
	LogError("Error unmarshaling get-job response for source", err)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling get-job response for source")

	Expect(len(getJobResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found for source")

	// Fetch the first jobRun's ID.
	jobRunID := getJobResp.JobRuns[0].JobRunId
	Expect(jobRunID).NotTo(BeEmpty(), "sourceDiscoveryJobRunID is empty")

	return jobRunID
}
