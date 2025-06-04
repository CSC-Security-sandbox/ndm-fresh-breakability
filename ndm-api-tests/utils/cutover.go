package utils

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

type BulkCutoverJobParams struct {
	SourcePathIDs      []string
	DestinationPathIDs []string
}

// CreateBulkCutoverJob creates bulk cutover jobs for all combinations of source and destination path IDs.
func CreateBulkCutoverJob(params BulkCutoverJobParams, headers map[string]string) []string {
	createBulkCutoverURL := JOB_SERVICE_URL + "/api/v1/jobs/bulk-cutover"

	// Build cutoverConfig as a slice of maps for all combinations
	var cutoverConfigs []map[string]interface{}
	for _, src := range params.SourcePathIDs {
		for _, dst := range params.DestinationPathIDs {
			cutoverConfigs = append(cutoverConfigs, map[string]interface{}{
				"sourcePathId":      src,
				"destinationPathId": []string{dst},
			})
		}
	}

	payload := map[string]interface{}{
		"cutoverConfig": cutoverConfigs,
	}
	payloadBytes, err := json.Marshal(payload)
	Expect(err).NotTo(HaveOccurred(), "Error marshaling bulk cutover job payload")

	resp, err := SendAPIRequest("POST", createBulkCutoverURL, payloadBytes, headers)
	Expect(err).NotTo(HaveOccurred(), "Error sending create bulk cutover job request")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusCreated)

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading bulk cutover job creation response")

	var bulkCutoverResp []map[string]interface{}
	err = json.Unmarshal(bodyBytes, &bulkCutoverResp)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling bulk cutover job creation response")
	Expect(len(bulkCutoverResp)).To(BeNumerically(">", 0), "No job config found in response")

	var jobConfigIDs []string
	for _, job := range bulkCutoverResp {
		if id, ok := job["id"].(string); ok && id != "" {
			jobConfigIDs = append(jobConfigIDs, id)
		}
	}
	Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")

	return jobConfigIDs
}
